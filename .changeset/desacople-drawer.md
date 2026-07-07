---
'@coongro/ai-copilot': minor
---

feat: copiloto desacoplado como bloque drawer, genérico y con cobro por tarea

- El frontend (screen-reader ARIA, actuador, loop del agente y chat) se mudó al
  plugin como utility action `panelType: 'drawer'`; usa `window.coongro`
  (navegación, menús, apiBaseUrl) en vez de imports del core.
- Prompt generalizado: opera cualquier módulo instalado guiándose por los menús,
  ya no está cableado al flujo de Consultas.
- Selector de inteligencia (Rápido/Estándar/Avanzado) y cobro de una Unidad de
  trabajo por tarea vía el gateway openrouter (mensaje claro si no hay saldo).
