# Prompts del Copilot IA: base + contexto por kit

El prompt que recibe el modelo en cada turno se **compone en dos capas**:

```
[ BASE / PROTOCOLO ]   ← lo aporta ESTE plugin (ai-copilot). Mecánica genérica.
        +
[ CONTEXTO DE NEGOCIO ] ← lo aporta el KIT activo del tenant. El rubro.
```

Separarlas es a propósito: si arreglás algo de la **mecánica** (formato JSON,
`navigate`, pickers…) lo hacés **una sola vez** en la base y sirve para todos los
kits. El kit solo agrega el **conocimiento del negocio** ("los pacientes son
animales", el flujo típico), nunca la mecánica.

---

## 1. La BASE (protocolo) — propiedad de ai-copilot

- **Dónde vive:** `src/prompt.ts` → `export const SYSTEM_PROMPT`.
- **Cómo se usa:** `getEffectivePrompt()` devuelve el override de dev si existe,
  si no `SYSTEM_PROMPT`. `composeSystemPrompt(businessContext)` = base + contexto.
- **Editar en vivo (dev):** `/dev/copilot` → card **"PROMPT DEL SISTEMA (DEV,
  GLOBAL)"**. Es un override **global** (no toca el default del código); aplica en
  la próxima tarea, sin reiniciar. En producción el endpoint es read-only y se usa
  el `SYSTEM_PROMPT` compilado.
- **Referencia / plantilla:** [`system-prompt.md.example`](./system-prompt.md.example)
  — copia legible de la base (incluye el fix de `navigate`). Es solo doc; la
  fuente de verdad es `src/prompt.ts`.

La BASE **no pertenece a ningún kit** — es el tronco común. Por eso el card de
"PROMPT DEL SISTEMA" no dice a qué kit pertenece.

---

## 2. El CONTEXTO DE NEGOCIO — lo declara cada kit

Cada **kit** (cada negocio distinto) shippea un `.md` con su contexto y lo
referencia en su manifest. El copiloto lo **anexa** a la base según el kit activo
del tenant.

### 2.1. Cómo se declara (que el archivo sea identificable)

En el `coongro.manifest.json` del kit, agregá el campo top-level
`copilotContext` apuntando al archivo:

```jsonc
{
  "id": "kit-veterinary",
  "version": "0.4.0",
  "apiVersion": "2.0",
  "copilotContext": {
    "file": "copilot-context.md"   // ruta relativa a la raíz del paquete del kit
  }
  // …resto del manifest
}
```

- La ruta es **relativa a la raíz del paquete** del kit (donde está el
  `coongro.manifest.json`), no a `dist/`.
- El core valida que termine en `.md` (Zod, en `module-core/ManifestValidator`).
- **Es lo que hace identificable al kit como aportante de contexto:** el resolver
  del core toma el **primer plugin activo del tenant que declare `copilotContext`**.
  Por convención del ecosystem **solo los kits lo declaran** y hay **1 kit por
  tenant**, así que no hay ambigüedad ni merge de varios prompts.

### 2.2. Que el archivo entre al paquete publicado

El `.md` debe estar en el tarball. Agregalo a `files[]` del `package.json` del
kit (junto a `coongro.manifest.json`):

```jsonc
"files": [
  "dist",
  "assets",
  "coongro.manifest.json",
  "copilot-context.md"
]
```

En **dev** se lee del fuente local (`plugins/<kit>/copilot-context.md`); en
**prod**, del paquete instalado desde Verdaccio.

### 2.3. Qué escribir adentro

Solo **dominio**, nunca mecánica. Partí de la plantilla:
[`copilot-context.md.example`](./copilot-context.md.example) — copiala a
`plugins/<tu-kit>/copilot-context.md` y completá quién es quién, cómo se organiza
el trabajo, el flujo típico y cómo interpretar objetivos.

### 2.4. Editar en vivo desde el dev panel

`/dev/copilot` → card **"CONTEXTO DE NEGOCIO POR KIT"**. Lista los kits que
declaran `copilotContext`, muestra el contenido y —**solo en dev**— permite
editarlo. Guardar hace **write-back al `.md`** del fuente local del kit (queda en
el fuente). En producción es **read-only** (el `.md` empaquetado manda).

---

## 3. Cómo llega al modelo (server-side)

1. El core resuelve, por tenant, el kit activo y lee su `.md`
   (`CopilotContextResolver`, cacheado; se invalida al activar/desactivar plugins
   o al editar desde el dev panel).
2. Lo inyecta **lazy** en el contexto del endpoint (`resolveCopilotContext()`),
   así solo el `/turn` del copiloto lo consume — el resto de los endpoints no paga
   el costo.
3. `buildMessages` en `src/prompt.ts` compone `composeSystemPrompt(businessContext)`
   = **BASE + CONTEXTO DEL NEGOCIO** y eso es lo que ve el modelo.

Si no hay kit con contexto, el copiloto opera igual con **solo la BASE**.

---

## Archivos de esta carpeta

| Archivo | Qué es |
|---------|--------|
| `copilot-prompts.md` | Esta guía. |
| `system-prompt.md.example` | Copia legible de la BASE (`src/prompt.ts`). Para overrides. |
| `copilot-context.md.example` | Plantilla del contexto de negocio que copia un kit. |
