---
'@coongro/ai-copilot': minor
---

Runtime MCP agentic (COONG-291): los inputs marcados con `ref` viajan como handles `recurso:id` que el runtime valida nominalmente y resuelve a ids crudos; las escrituras con `confirmation: always` requieren un flujo de dos pasos con token de un solo uso atado a los argumentos exactos; cada conexión puede llevar una `AgentConnectionPolicy` (allow/deny, modo, política de confirmación) sobre el mismo catálogo compilado; y toda invocación deja rastro de auditoría estructurado.
