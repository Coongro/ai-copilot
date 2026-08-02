# Por qué `ai-copilot.connections` es un repositorio privado

En `coongro.manifest.json`:

```json
{
  "module": "./dist/repositories/agent-connection.repository.js",
  "export": "ConnectionRepository",
  "prefix": "ai-copilot.connections",
  "copilot": false
}
```

**Ese `copilot: false` no es cosmético. Sin él, un agente de solo lectura puede emitirse
una conexión de administrador.**

## Qué pasó

El generador de capacidades del Builder deriva qué puede hacer un agente de lo que la UI
ya expone: un recurso se vuelve publicable **porque una vista lo usa**, y sus escrituras
aparecen **porque existe un formulario para él** (sin `onSubmit` custom). Es un buen
criterio: lo que una persona opera desde una pantalla, un agente debería poder operarlo.

Al componer la vista **Nueva conexión** en el Builder, ese criterio se cumplió al pie de la
letra y el catálogo pasó a publicar:

```
ai-copilot_connections_list
ai-copilot_connections_create   ← acá está el problema
```

Con `create` publicada, cualquier conexión —incluida una de perfil `readonly`— podía llamar
a la herramienta y crearse otra con perfil `admin`. El resto de las defensas (perfiles,
alcance por kit, límites) quedan sin efecto: el agente se emite una credencial nueva y
entra por la puerta principal.

## Por qué el criterio no alcanza acá

"Hay una vista, luego es exponible" vale para contratos, pacientes o productos. No vale
para el recurso que **gobierna el acceso de los propios agentes**: publicarlo le da al
agente poder sobre sus propios permisos.

El mismo razonamiento aplica a cualquier repositorio que administre credenciales, tokens de
integración, webhooks o auditoría de accesos. Si le hacés una pantalla en el Builder,
marcalo `copilot: false` en el mismo commit.

## Cómo se comporta

`copilot: false` corta los **dos** caminos por los que el generador publica:

1. el CRUD derivado del recurso, y
2. las acciones cableadas en vistas (el botón «Eliminar» de una tabla).

Está cubierto por un test en el Builder (`server/copilot-capabilities.test.mjs`): _"un
repositorio marcado copilot:false no publica NADA, aunque una vista lo use"_.

## Cómo verificarlo

Borrarlo del manifest a mano **no sirve**: `sync_copilot_capabilities` corre solo en cada
`assign_artifact` y en cada guardado de vista asignada, y lo repone. La comprobación real
es guardar una vista del plugin y mirar que el catálogo siga vacío:

```bash
# tras guardar cualquier vista de ai-copilot
python -c "import json;m=json.load(open('coongro.manifest.json',encoding='utf-8'));print(m['contributes'].get('copilotCapabilities'))"
# -> None

# y contra el servidor MCP, con una conexión de perfil admin:
curl -s -X POST "$URL" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -c connections
# -> 0
```

Las conexiones se administran desde la web, por una persona. Ver `mcp-connections.md`.
