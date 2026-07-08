---
'@coongro/ai-copilot': minor
---

feat(copilot): robustez del observador/actuador + contrato de verificación en finish

Mejoras surgidas de testing en vivo (gpt-oss-120b operando el kit veterinario):

- **accname:** separa el texto por frontera de sub-elemento (evita "RoccoLabrador";
  ahora "Rocco Labrador"), para que los pickers de búsqueda no reciban un término
  sobre-específico.
- **actuator (selectInCombobox):** reintenta con prefijos más cortos cuando el
  buscador async no devuelve opciones; match bidireccional sin adivinar.
- **agent:** circuit breaker que corta bucles de acción fallida repetida.
- **panel:** botón "Detener" mientras el agente opera.
- **screen-reader:** detección de región (filter/row-action) para distinguir la
  barra de filtros de los campos de formulario; ignora headers de columna.
- **prompt:** documenta el verbo `navigate`, bloque "MIRÁ ANTES DE ACTUAR", render
  por región, FECHA DE HOY para fechas relativas, y contrato de `finish` reforzado
  (no declarar éxito sin evidencia observable; nunca finalizar en el mismo turno
  que se confirma).
