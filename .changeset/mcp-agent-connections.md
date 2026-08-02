---
'@coongro/ai-copilot': minor
---

feat(mcp): conectar Claude, ChatGPT o Codex al Copilot headless (COONG-288)

Nuevo endpoint MCP (`POST /mcp`, JSON-RPC sobre HTTP) que publica como tools las capacidades declaradas por los plugins activos del tenant, y las vistas **Agentes IA** (compuestas en el View Builder sobre el repositorio `ai-copilot.connections`) para listar, crear, revocar y borrar conexiones. Cada conexión tiene un perfil —solo lectura, operador o administrador— que filtra las capacidades por efecto tanto al listar como al ejecutar.

El token se muestra una sola vez y se guarda hasheado; revocarlo corta el acceso en la llamada siguiente. El adaptador no declara acciones propias: todo sale del catálogo de capacidades.

Las lecturas con contrato de salida se proyectan a campos legibles, traducen formatos y referencias, conservan un `_ref` estructurado para operar el registro y aplican paginación defensiva (`limit`/`offset`, máximo 50) aunque una action legacy devuelva la tabla completa.

Cada conexión puede atarse a un kit: el catálogo se filtra por sus plugins y el kit se vuelve a comprobar al ejecutar, con la misma regla que la sesión web. El repositorio de conexiones no declara capacidades headless a propósito — un agente que pudiera crearlas se emitiría uno de perfil administrador a sí mismo.
