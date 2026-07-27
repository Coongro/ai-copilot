# Observador y Actuador del Copiloto — contrato y mantenimiento

**Archivos:** `src/panel/screen-reader.ts` (observar) · `src/panel/accname.ts` (nombres) · `src/panel/actuator.ts` (actuar) · `src/prompt.ts` (protocolo hacia el LLM) · `src/parse.ts` (validación de acciones) · `src/types.ts` + `src/panel/types.ts` (contrato espejado)

Este documento es la fuente única de verdad del contrato "qué hace a un componente legible/operable por el Copiloto". Si tocás cualquiera de los archivos de arriba, actualizá esto.

---

## El contrato en una oración

Un control es **legible** por el Copiloto si (1) expone un **rol reconocible** (nativo o ARIA) y (2) su **nombre accesible** resuelve a texto no vacío. Un control es **operable** si además no está `disabled` y su familia tiene driver en el actuador.

### 1. Roles reconocibles (qué lee `observe()`)

| Familia | Selector | `kind` emitido | Lector |
|---|---|---|---|
| Radios ARIA | `[role="radiogroup"]` + `[role="radio"]` | `choice` | `readChoices` |
| Tabs | `[role="tablist"]` + `[role="tab"]` | `choice` | `readChoices` |
| Radios nativos | `input[type="radio"]` (agrupados por `name`) | `choice` | `readNativeRadioGroups` |
| Combobox | `[role="combobox"]` | `select` | `readComboboxes` |
| Select nativo | `select` | `choice` | `readNativeSelects` |
| Inputs | `input`, `textarea` (menos los del set SKIP) | `text` / `number` / `date` | `readInputs` |
| Toggles | `[role="checkbox"]`, `[role="switch"]`, `input[type="checkbox"]` | `toggle` | `readToggles` |
| Numéricos | `[role="spinbutton"]`, `[role="slider"]` | `number` | `readNumbers` |
| Expandibles | `[aria-expanded]` (no combobox) + `details > summary` nativo (estado en `details.open`) | `expandable` | `readExpandables` |
| Botones | `button`, `[role="button"]`, `a[href]`, `input[type="submit"|"button"]` | `button` | `readButtons` |
| Tablas | `table` (todas las visibles; filas = `button`) | — | `readTables` |

**Orden de lectura:** los grupos compuestos van primero y "reclaman" su subtree (`claimed` WeakSet) para que los lectores simples no dupliquen sus piezas. Si agregás un lector de grupo, ubicalo antes de los simples en `observe()`.

### 2. Nombre accesible (`computeAccessibleName`)

Prioridad: `aria-labelledby` → `aria-label` → `<label for>` / label envolvente → label "huérfano" en el wrapper (convención de forms Coongro: `<Label>` hermano sin `htmlFor`) → texto propio (botones/tabs; en `input[type=submit]` es su `value`) → `placeholder` → `title` → título de la sección contenedora.

⚠️ El corte de `fromWrapperLabel` al llegar a un contenedor con varios campos evita "robar" el label de otra sección — no lo relajes.

### 3. Estados

| `state` | Significado | Quién lo respeta |
|---|---|---|
| `disabled` | Existe pero está bloqueado (`disabled`, `aria-disabled`, `fieldset[disabled]`) | Prompt le dice al modelo que NO lo accione; `assertEnabled` del actuador lo rechaza con error descriptivo |
| `readonly` | Input de solo lectura (no picker) | `doType`/`doSetNumber` lo rechazan |
| `checked` / `unchecked` / `mixed` | Toggles (ARIA o nativo, `indeterminate` = mixed) | `doToggle` es idempotente |
| `expanded` / `collapsed` | Expandibles | `doExpand` es idempotente; `open: false` pliega |

### 4. Capas (`getScope`)

Overlay abierto gana a `main`; popover gana a ambos. Reconoce `[role="dialog"]`, `[role="alertdialog"]` y `<dialog open>`; `data-state` solo descarta si tiene valor distinto de `"open"` (soporta overlays no-Radix). Con overlays apilados gana el último del DOM. Todo lo que esté dentro de `[data-cg-copilot-panel]` se excluye (el agente no se lee a sí mismo).

### 5. Pickers de fecha

Un input `readOnly` se considera trigger de fecha **solo** si tiene `data-cg-control="date"` o `aria-haspopup`. Si creás un picker nuevo con input readonly, **marcálo con `data-cg-control="date"`** (así lo hacen DatePicker/TimePicker/DateTimePicker del plugin calendar). Un readonly sin marca se emite como `text` con state `readonly`.

---

## Principios del actuador

1. **Nunca fallar en silencio.** Si algo no se pudo hacer (opción inexistente, control disabled, valor no alcanzado), tirar `Error` con mensaje descriptivo — el loop lo guarda en `history` y el modelo se recupera leyéndolo.
2. **Nunca adivinar.** `pickByLabel` NO tiene fallback a "la primera opción": si el modelo pidió una opción que no existe, el error **lista las opciones disponibles** para que elija una real. Query vacío = primera opción (eso sí es parte del protocolo).
3. **Idempotencia por estado**: `toggle`/`expand` leen el estado actual antes de clickear.
4. **Verificar el resultado** cuando se pueda: `stepTo`/`slideTo` comprueban `aria-valuenow` final y fallan si no llegaron.
5. Sliders ARIA se manejan por **teclado** (ArrowLeft/Right sobre el elemento con `role="slider"`), no por click.

---

## Checklist: agregar soporte para una familia de widgets nueva

1. **Lector** en `screen-reader.ts`: selector + `claimed` + `emit()` con `kind` y estado. Decidir posición en el orden de `observe()`.
2. **Kind nuevo** (si aplica): agregarlo a `ControlKind` en **ambos** types (`src/types.ts` y `src/panel/types.ts` — están espejados a mano).
3. **Driver** en `actuator.ts` + case en `act()`.
4. **Verbo/acción** (si aplica): `AgentAction` en ambos types + spec en `parse.ts` (`SPECS`).
5. **Protocolo**: documentar el kind/verbo en `SYSTEM_PROMPT` (prompt.ts) — si el modelo no sabe que existe, no lo usa. Ojo: el dev panel puede tener un **override del prompt** guardado (config-store); un kit nuevo en el default no llega a tenants con override viejo.
6. **Este documento**: fila en la tabla de roles.
7. Probar con el copiloto en vivo sobre una vista real que use el widget.

## Limitaciones conocidas (a hoy)

- **Grids hechos con divs** (`role="grid"` o layouts de cards) no se leen como tabla — solo `<table>` real.
- **`input[type="file"]`** no está soportado (subir archivos requeriría un driver especial).
- **Shadow DOM e iframes**: `querySelectorAll` no entra; nada adentro es visible para el agente.
- **Contenido canvas/SVG interactivo**: invisible por diseño (no hay semántica que leer).
- Los **refs** (`data-cg-ai-ref`) se regeneran en cada `observe()`; si React re-monta el nodo entre observar y actuar, el driver falla con "No encontré el elemento" y el modelo reintenta en el próximo turno (esperado).
- El **menú** se cachea 60 s (`MENU_TTL_MS`); activar un plugin puede tardar hasta eso en aparecer para el agente.

## Registro de correcciones

### 2026-07-07 — Auditoría de robustez (rama `feature/copilot-observe-robustez`)

- **Controles nativos invisibles**: `input[type=checkbox]` ahora entra por `readToggles`; `input[type=radio]` por `readNativeRadioGroups` (agrupa por `name`, emite `choice` en el ancestro común); `input[type=submit|button]` por `readButtons` (nombre = `value`, vía `ownText` en accname).
- **`getScope` Radix-only**: soporta `<dialog open>` y overlays sin `data-state`; con overlays apilados gana el último; exclusión del panel del copiloto por `closest()` (cubre alertdialog y popovers internos).
- **Readonly ≠ fecha**: se eliminó el fallback "cualquier readonly es date"; ahora exige `data-cg-control="date"` o `aria-haspopup`. Readonly genérico → `text` + state `readonly`.
- **Disabled visible y respetado**: todos los lectores emiten state `disabled`; `assertEnabled` en todos los drivers; nota en el prompt.
- **Opciones ocultas**: `readChoices` filtra por visibilidad (antes ofrecía opciones que el actuador no podía clickear).
- **Fin del fallback silencioso**: `pickByLabel` reemplaza a `pickByName`; sin match → error que lista las opciones disponibles (aplica a choice, combobox y select nativo).
- **Tablas múltiples**: `ObservedScreen.table` → `tables[]` con `name` (caption/aria-label); el prompt las renderiza todas.
- **Sliders**: driver por teclado (`slideTo`) con verificación de `aria-valuenow`; antes era un no-op silencioso.
- **Steppers verificados**: `stepTo` falla si no hay botones +/- o si no alcanzó el valor.
- **Combobox con placeholder**: `data-placeholder` (Radix) ⇒ value vacío (antes reportaba "Seleccionar..." como valor elegido).
- **Expand bidireccional**: `{ type: "expand", open: false }` pliega; `doExpand` idempotente.

Endurecimiento post-review (silent-failure hunt, misma rama):

- **Verificar tras actuar** en todos los drivers con estado observable: `doToggle` re-lee el checked cuando el modelo pidió un estado concreto; `doExpand` exige `aria-expanded` y verifica el cambio; `stepTo` falla también cuando el control no expone `aria-valuenow` (antes retornaba OK sin hacer nada).
- **`doPickDate` nativo**: adapta el formato al `type` del input (`coerceDateValue`) y verifica que el value haya quedado — los inputs nativos rechazan formatos inválidos EN SILENCIO dejando `value=''`.
- **Radios nativos**: si el ancestro común ya está reclamado, el grupo sube hasta un host libre (no se descarta); el host lleva `data-cg-ai-radios="<name>"` y el actuador restringe las opciones a ese grupo (evita clickear radios de otro grupo bajo el mismo contenedor).
- **`act()` exhaustivo**: verbo sin driver tira error (guard `never`) en vez de "ejecutarse" sin hacer nada.

### 2026-07-07 — Avisos efímeros (toasts) (COONG-231)

Los toasts (Sonner, `[data-sonner-toast]`) duran segundos y el agente observa DESPUÉS de actuar — nunca veía el "Guardado" ni los errores de validación. `startNoticeCapture()` (MutationObserver sobre body, arranca al montar el drawer y perezosamente en `observe()`) bufferea cada toast al aparecer; `observe()` reporta los de los últimos 30 s (máx. 5) en `ObservedScreen.notices` y el prompt los muestra como "AVISOS RECIENTES". Si se cambia la librería de toasts del host, actualizar el selector.

### 2026-07-07 — `<details>/<summary>` nativo (COONG-231)

Hallado por `audit_copilot` del View Builder: el contenedor Plegable del Builder genera `<details>/<summary>` sin `aria-expanded`, familia que el reader no soportaba → los Plegables eran invisibles e inoperables para el copiloto. Fix: `readExpandables` lee `details > summary` (estado desde `details.open`) e `isExpandedNow` del actuador lo opera (el click en summary togglea nativo).

### 2026-07-27 — Gráficos: canal `figures` (COONG-271)

Los gráficos del design system (`BarChart`, `LineChart`, `DonutChart`, `TrendCard`) se anuncian
correctamente como `role="img"` con un `aria-label` que enumera la serie — y aun así el copiloto era
**ciego** a ellos: `observe()` solo tenía canales para controles, tablas, toasts y menús, así que
parado en un tablero el agente no podía responder "¿cuánto vendí este mes?".

Medido antes del fix: con tres gráficos montados, `observe().controls` traía el botón de prueba y
ningún gráfico; los tres `[role="img"]` estaban en el DOM con su descripción completa.

- `readFigures()` recorre `[role="img"]` visibles del scope y emite `{ name, description }` partiendo
  el nombre accesible por el primer `": "` (convención del DS: «Gráfico de barras: Ene $32, …»).
  Topes: 12 figuras por pantalla y 400 caracteres por descripción — un tablero grande no debe inflar
  el prompt.
- `ObservedScreen.figures` (contrato en `src/types.ts` y `src/panel/types.ts`); el prompt las renderiza
  como "GRÁFICOS", aclarando que son informativos (no se clickean ni se editan).
- Como el nombre accesible se recalcula en cada `observe()`, un gráfico que recarga por RPC se lee
  actualizado en la foto siguiente. Los gráficos del core reportan «cargando datos…» mientras el RPC
  está pendiente en vez de describir la serie de diseño: si no, el agente reportaría datos de relleno
  como si fueran reales.
