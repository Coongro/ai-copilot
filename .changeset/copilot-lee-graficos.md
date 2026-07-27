---
'@coongro/ai-copilot': minor
---

El copiloto ahora lee los gráficos. `observe()` suma el canal `figures`: el contenido anunciado como
`role="img"` (gráficos de barras, línea, dona, métricas con tendencia) se reporta con su nombre y los
datos que muestra, y el prompt lo renderiza como "GRÁFICOS". Antes el agente era ciego a un tablero
entero: no había canal para contenido informativo, así que no podía responder sobre lo que el usuario
estaba mirando. Topes: 12 figuras por pantalla, 400 caracteres por descripción.
