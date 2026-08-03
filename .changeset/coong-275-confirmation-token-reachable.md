---
'@coongro/ai-copilot': patch
---

El token de confirmación llega al agente por el contrato, no solo por el structured

Confirmar una escritura es repetir la llamada con el token que devolvió la primera,
pero `confirmationToken` no estaba declarado en el `inputSchema` de la tool y el
schema es `additionalProperties: false`: el agente no tenía por dónde mandarlo. El
valor tampoco aparecía en el texto, solo en `structuredContent`, que no todos los
clientes le muestran al modelo. Resultado: ninguna escritura podía completarse por
MCP, y el agente respondía —correctamente— que no encontraba forma de generar el
token.

Las capabilities de escritura ahora lo declaran como argumento opcional y el texto
de `confirmation_required` incluye el valor. La garantía no cambia: el token sigue
siendo de un solo uso, atado a la conexión, la capability y el hash de los
argumentos, así que conocerlo no habilita ninguna otra operación.

El test nuevo verifica el token desde `tools/list` — los que había leían el valor de
`structuredContent`, que se saltea el contrato público y por eso pasaban con el bug.
