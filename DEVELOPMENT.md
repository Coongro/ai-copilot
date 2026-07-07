# ai-copilot - Development Guide

## Branching Model

Este plugin sigue el mismo modelo de ramas que el monorepo core:

```
feature/* ──→ develop ──→ staging ──→ main
                           │            │
                           ▼            ▼
                      Staging env   Production env
```

### Ramas permanentes

| Rama | Propósito | Deploy automático |
|------|-----------|-------------------|
| `develop` | Integración de features | Solo CI (quality checks) |
| `staging` | Pre-producción, QA | Publish a staging Verdaccio |
| `main` | Producción | Publish a production Verdaccio |

### Ramas temporales

| Tipo | Patrón | Sale de | Merge a |
|------|--------|---------|---------|
| Feature | `feature/<issue>-<desc>` | `develop` | `develop` |
| Hotfix | `hotfix/<issue>-<desc>` | `main` | `main` + `develop` + `staging` |

### Workflow

1. Crear feature branch desde `develop`
2. Desarrollar y hacer PR a `develop`
3. CI valida (typecheck, lint, format, build)
4. Merge a `develop`
5. Cuando esté listo para QA: merge `develop` → `staging`
6. Staging se publica automáticamente al Verdaccio de staging
7. Probar en `staging.coongro.com`
8. Cuando esté OK: merge `staging` → `main`
9. Main se publica automáticamente al Verdaccio de producción
10. Tag y GitHub Release se crean automáticamente

### Hotfix

1. Crear rama desde `main`: `hotfix/<issue>-<desc>`
2. Fix + bump version en `package.json` y `coongro.manifest.json`
3. PR directo a `main`
4. Merge → publish automático a producción
5. `post-release.yml` sincroniza `staging` y `develop` automáticamente

## Setup inicial del repositorio

```bash
# Crear ramas permanentes
git checkout -b develop
git push origin develop
git checkout -b staging
git push origin staging

# Configurar default branch a develop
gh repo edit --default-branch develop
```

### GitHub Secrets (GitHub Settings → Secrets → Actions)

Los workflows de CI y Publish necesitan estos secrets para resolver paquetes `@coongro/*`:

| Secret | Descripción |
|--------|-------------|
| `STAGING_VERDACCIO_URL` | URL del Verdaccio de staging (ej: `https://coongro-staging.up.railway.app`) |
| `STAGING_VERDACCIO_URL_HOST` | Host sin protocolo (ej: `coongro-staging.up.railway.app`) |
| `STAGING_VERDACCIO_TOKEN` | Token JWT de autenticación para staging Verdaccio |
| `PROD_VERDACCIO_URL` | URL del Verdaccio de producción (ej: `https://registry.coongro.com`) |
| `PROD_VERDACCIO_URL_HOST` | Host sin protocolo (ej: `registry.coongro.com`) |
| `PROD_VERDACCIO_TOKEN` | Token JWT de autenticación para production Verdaccio |

> **Nota**: Los core packages (`@coongro/plugin-sdk`, etc.) se resuelven automáticamente
> a través de Verdaccio, que los proxea desde GitHub Packages. No se necesita configurar
> `GH_PACKAGES_TOKEN` en los repos de plugins.

### Branch Protection Rules (GitHub Settings → Branches)

Para las 3 ramas protegidas (`main`, `staging`, `develop`):
- ✅ Require pull request before merging
- ✅ Require status checks to pass (CI workflow)
- ✅ Do not allow force pushes
- ✅ Do not allow deletions

## Versionamiento

El version bump se hace manualmente antes de promover a main:

```bash
# En la rama staging o en un PR a main
npm version patch   # 1.0.0 → 1.0.1 (fix)
npm version minor   # 1.0.0 → 1.1.0 (feature)
npm version major   # 1.0.0 → 2.0.0 (breaking)
```

El script `version` sincroniza automáticamente `coongro.manifest.json`.

## Desarrollo local

```bash
# En el monorepo, compilar el plugin
cd plugins/ai-copilot
npm run build

# Publicar a Verdaccio local (solo la primera vez)
npm publish --registry http://localhost:4873/

# Después, solo compilar — hot reload carga desde plugins/ directamente
npm run build
# Reiniciar API solo si cambian schemas
```

## Database Triggers

If your plugin needs PostgreSQL triggers, follow this naming convention so the system
can automatically manage them when the plugin is activated/deactivated:

- **Trigger name**: `trg_ai_copilot_{descriptive_name}`
- **Function name**: `trg_ai_copilot_{descriptive_name}_fn`

Where `ai_copilot` is your plugin's moduleId (pluginId with hyphens replaced by underscores).

### Example

```sql
-- In a Drizzle migration file (drizzle/NNNN_name.sql):

CREATE OR REPLACE FUNCTION "trg_ai_copilot_audit_log_fn"()
RETURNS TRIGGER AS $$
BEGIN
  -- Your trigger logic here
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_ai_copilot_audit_log"
AFTER INSERT OR UPDATE ON "module_ai_copilot_items"
FOR EACH ROW
EXECUTE FUNCTION "trg_ai_copilot_audit_log_fn"();
```

> **Important**: The system automatically **DISABLE**s all `trg_ai_copilot_*` triggers when the plugin
> is deactivated, and **ENABLE**s them when reactivated. Triggers that don't follow this naming
> convention will NOT be managed automatically.
