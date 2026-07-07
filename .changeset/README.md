# Changesets

Este directorio contiene archivos de changesets que describen cambios pendientes.

## Uso

```bash
# Crear un changeset después de hacer cambios
npx changeset

# Ver changesets pendientes
npx changeset status
```

Cada changeset describe qué cambió y el tipo de bump (patch/minor/major).
Los changesets se consumen automáticamente al mergear a staging.
