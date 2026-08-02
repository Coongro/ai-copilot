---
'@coongro/ai-copilot': minor
---

feat(mcp): aplicar defaults y valores fijos del contrato headless

El adaptador inyecta `default` y `const` de forma recursiva antes de validar y ejecutar una action. Los campos fijos no se publican como argumentos controlables por el cliente, por lo que UI, MCP y futuros canales comparten las mismas invariantes generadas por Builder.
