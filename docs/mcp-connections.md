# Conexiones MCP (Claude / ChatGPT / Codex)

El plugin expone el Copilot headless como **servidor MCP remoto**. Cualquier cliente
compatible —Claude, ChatGPT, Codex— se conecta al mismo endpoint; el tipo de canal es
el protocolo (`mcp`), no el producto.

## Piezas

| Pieza                   | Dónde vive                                                     | Qué hace                                                                                                                 |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Catálogo de capacidades | core (`CopilotCapabilitiesResolver`)                           | Junta los `contributes.copilotCapabilities[]` (COONG-288) de los plugins **activos** del tenant y calcula una `revision` |
| Primitivas de canal     | core (`PluginPlatformAPI` en el contexto HTTP)                 | `databaseFor` · `listCopilotCapabilities` · `executeAction`, todas con `tenantId` explícito                              |
| Adaptador MCP           | `src/mcp/`                                                     | JSON-RPC 2.0 sobre HTTP: `initialize`, `tools/list`, `tools/call`, `ping`                                                |
| Conexiones              | repositorio `ai-copilot.connections`                           | ABM sobre `module_ai_copilot_agent_connections`: token hasheado, perfil, kit, estado, último uso                         |
| UI                      | vistas del Builder (`conexiones-de-agentes`, `nueva-conexion`) | Listar, crear, revocar y borrar; menú **Agentes IA**                                                                     |

El adaptador **no declara acciones propias**: todo lo que el agente puede hacer sale del
catálogo. Agregar una capacidad a un plugin la publica automáticamente como tool.

Las capacidades generadas pueden incluir un contrato `output`: el adaptador proyecta solo
los campos visibles, usa nombres camelCase y etiquetas del cliente, traduce enums, formatea
fechas/montos y resuelve referencias declaradas. Las colecciones aceptan `limit` + `offset`;
el default sale del componente visual y nunca supera 50 filas. `_ref` conserva el identificador
técnico únicamente en la respuesta estructurada para encadenar acciones posteriores.

## Autenticación

El token va en la URL (`?k=cnx_<tenant>_<secreto>`) porque Claude y ChatGPT solo permiten
pegar una URL; también se acepta `Authorization: Bearer`. El tenant viaja adentro del token
porque el endpoint es público y sin tenant no hay base de datos donde buscar la conexión —
lo que autentica es el secreto, que se guarda hasheado.

Revocar una conexión corta el acceso en la siguiente llamada.

## Perfiles

| Perfil     | Efectos publicados             |
| ---------- | ------------------------------ |
| `readonly` | `read`                         |
| `operator` | `read`, `write`                |
| `admin`    | `read`, `write`, `destructive` |

El filtro se aplica **en cada `tools/call`**, no solo al listar: que una tool haya aparecido
en un `tools/list` viejo no habilita nada.

## Probar en local

1. Exponer la API por un túnel (los clientes web necesitan URL pública):

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

2. Poner esa URL en `COONGRO_PUBLIC_API_URL` (`.env.docker`) y **recrear** el contenedor —
   `env_file` no se relee en un `docker restart`:

   ```bash
   docker compose up -d --force-recreate --no-deps api
   ```

3. En Coongro: menú **Agentes IA** → _Nueva conexión_ → nombre + permisos. Al guardar, la URL se copia sola al portapapeles: es la única vez que se muestra.

4. Pegarla en el cliente:
   - **Claude**: Configuración → Conectores → Agregar conector personalizado.
   - **ChatGPT**: Configuración → Conectores (modo desarrollador) → Nuevo.
   - **Codex u otros**: servidor MCP remoto por HTTP.

Verificación por consola:

```bash
curl -s -X POST "$URL" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Salvaguardas

| Salvaguarda          | Comportamiento                                                                                      | Ajuste                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Rate limit           | 60 llamadas/min por conexión, y 20 de ellas pueden ser escrituras                                   | `AI_COPILOT_MCP_RATE_LIMIT`, `AI_COPILOT_MCP_WRITE_RATE_LIMIT` |
| Idempotencia         | Una escritura idéntica repetida dentro de 60 s devuelve el resultado anterior sin volver a ejecutar | —                                                              |
| Validación           | Tipos, `enum`, `format`, `pattern`, objetos anidados y arrays, contra el schema declarado           | —                                                              |
| Salida legible       | Allowlist de campos, labels, enums, formatos y referencias desde `output`                           | Contrato generado por Builder                                  |
| Paginación defensiva | `limit`/`offset`, default visual y máximo 50 aunque el repositorio ignore args                      | `AI_COPILOT_MCP_MAX_ROWS`                                      |
| Tope de respuesta    | 60 000 caracteres; el recorte se le avisa al agente en el texto                                     | `AI_COPILOT_MCP_MAX_CHARS`                                     |
| Vigencia del token   | 90 días por defecto, máximo 365; vencida no autentica                                               | Al crear la conexión                                           |

Rate limit e idempotencia viven **en memoria del proceso**: con una sola instancia de API
alcanza, con varias los límites pasarían a ser por instancia. Ahí van a Redis.

## Reglas del repositorio

`ai-copilot.connections` **no declara `copilotCapabilities` y no debe declararlas**: un agente
que pudiera crear conexiones se emitiría una de perfil administrador a sí mismo. Las conexiones
se administran desde la web, por una persona.

## Límites conocidos

- **Sin OAuth**: la conexión identifica al tenant y al perfil, no a la persona. La
  autorización por usuario llega con OAuth 2.1 (tarea aparte).
- **Sin streaming**: un POST, una respuesta JSON. No hay SSE, así que el servidor no puede
  avisar `notifications/tools/list_changed`: cuando el catálogo cambia, la conexión queda
  marcada como desactualizada en la UI y hay que reconectar el cliente.
- El endpoint devuelve `200` con cuerpo vacío ante una notificación JSON-RPC; la spec pide
  `202`, pero el contrato de handlers del core no permite fijar el status.
- **El alta no elige el kit**: el motor ya lo soporta (columna `kit_id`, catálogo y ejecución
  filtrados), pero el formulario no lo pide porque el pluginId no es tipeable y el kit de la
  sesión todavía no llega al plugin. Hasta entonces, las conexiones nuevas nacen con acceso a
  todo el espacio.
- **La URL se copia al portapapeles, no se muestra**: revelar un secreto una sola vez con botón
  de copiar no existe como bloque del Builder (tarea de `builder-component`).
