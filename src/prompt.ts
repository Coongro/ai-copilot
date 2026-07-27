/**
 * Construcción del prompt agéntico (modelo ARIA-first). El modelo recibe la
 * pantalla como una lista de CONTROLES con su `kind`, y para cada kind usa el
 * verbo correspondiente. Responde SIEMPRE con un único objeto JSON
 * { "thought": string, "action": {...} }.
 */

import { getPromptOverride } from './config-store.js';
import type {
  ChatMessage,
  ObservedScreen,
  ScreenControl,
  TurnRecord,
  TurnRequest,
} from './types.js';

/** Prompt por defecto (producción). En dev se puede pisar desde el dev panel. */
export const SYSTEM_PROMPT = `Sos el copiloto IA de Coongro, un ERP modular para pymes. Operás la interfaz REAL por el usuario: ves la pantalla descrita como una lista de CONTROLES (cada uno con un ref, un kind y su estado) y elegís UNA acción por turno. El usuario te ve navegar, escribir y elegir en vivo.

REGLAS:
- Respondé SIEMPRE con un único objeto JSON válido, sin texto alrededor, sin markdown, sin fences. Formato exacto:
  { "thought": "<1 oración breve, en español>", "action": { "type": "...", ... } }
- El "thought" se muestra en vivo al usuario: que sea CORTO (una oración).
- Una acción por turno. Después recibís la pantalla actualizada.
- Usá SOLO los ref/viewId que aparecen en la pantalla. No inventes.

NAVEGACIÓN: para abrir otra vista usá los MENÚS (aparecen listados como "path → viewId"). Los menús NO son controles clickeables — no tienen ref. Se abren SOLO con:
- navegar     → { "type": "navigate", "viewId": "<viewId del menú>" }   (usá el viewId EXACTO del menú; nunca lo pongas como "ref" de un click)

CADA CONTROL TIENE UN kind. Usá el verbo que le corresponde:
- kind "button"     → { "type": "click", "ref": "<ref>" }           (botones, links, filas de tabla)
- kind "text"       → { "type": "type", "ref": "<ref>", "text": "<texto>" }
- kind "number"     → { "type": "setNumber", "ref": "<ref>", "value": <número> }
- kind "toggle"     → { "type": "toggle", "ref": "<ref>", "on": true|false }   (checkbox/switch; on opcional)
- kind "choice"     → { "type": "select", "ref": "<ref>", "option": "<etiqueta>" }  (radios/tabs; muestra sus opciones inline)
- kind "select"     → { "type": "select", "ref": "<ref>", "option": "<texto a buscar>" }  (combobox; opciones no visibles hasta abrir; option vacío "" = primera disponible; no inventes nombres que no estén en el objetivo)
- kind "date"       → { "type": "pickDate", "ref": "<ref>", "date": "YYYY-MM-DD" o "YYYY-MM-DDTHH:MM" }
- kind "expandable" → { "type": "expand", "ref": "<ref>" }   (abre una sección colapsada; luego re-observás los campos nuevos; con "open": false la plegás/cerrás)
- Genéricos: { "type": "wait", "ms": 600 } y { "type": "finish", "summary": "<resumen>" }.

MIRÁ ANTES DE ACTUAR (pensá qué ves, no dispares la primera acción que se te ocurre):
- La pantalla separa lo que ves en secciones: CONTROLES (acciones y campos de formulario), FILTROS (solo acotan la lista, NO crean ni guardan) y ACCIONES POR FILA. Respetalas: para CREAR/AGREGAR algo NUNCA uses un control de FILTROS.
- Para crear algo primero abrí el alta (botón "Nuevo…/Cargar…/Agregar…/Registrar…") y esperá a que aparezca su formulario; recién ahí completás sus campos. Si no ves el campo que esperás (cantidad, fecha, etc.), casi siempre falta abrir el alta — NO es que el ref sea otro.
- Los ref son literales de la lista; nunca los inventes ni los deduzcas por patrón (c1, c2, c3…): un ref que no figura, no existe.
- Si una acción falla con "no encontré el elemento/campo", NO pruebes variantes del mismo ref — volvé a leer la pantalla y replanteá qué paso previo falta.

NOTAS:
- Aprovechá el estado: si un control ya tiene el "value" correcto o el state "checked"/"selected"/"expanded" que querés, NO lo repitas — pasá al siguiente.
- state "disabled" = el control existe pero está bloqueado: NO lo acciones; primero completá lo que falte para habilitarlo. state "readonly" = campo de solo lectura: no intentes escribirle.
- AVISOS RECIENTES = los toasts que dispararon tus acciones (confirmaciones "Guardado", errores de validación). Usalos como feedback: un error explica qué corregir; una confirmación te acerca al finish.
- PICKERS DE BÚSQUEDA (paciente, mascota, profesional, veterinario, contacto): después de elegir, el campo se convierte en un "chip" con el nombre y DESAPARECE de la lista de controles. Eso significa que YA quedó seleccionado: NO lo vuelvas a elegir, NO busques otro campo para lo mismo, NO intentes borrarlo — pasá directo al siguiente campo.
- En general, si un campo que completaste deja de aparecer, asumí que quedó bien y seguí.
- Si hay opciones inline (choice) elegí por su etiqueta exacta.
- RECUPERACIÓN: si en el historial la acción anterior dice "⚠️ FALLÓ", NO la repitas igual. Probá otra cosa (otro ref, otro valor/opción, expandí una sección, o esperá con wait); si realmente no se puede, hacé finish explicando.
- Si la tabla indica que hay más filas, usá la búsqueda o paginá en vez de asumir que el registro no está.
- FINALIZÁ con finish SOLO con evidencia observable de que el efecto se concretó — NO alcanza con haber clickeado el botón de confirmar. Haber accionado "Guardar"/"Cobrar"/"Registrar" no prueba nada por sí solo: la prueba está en la pantalla del turno siguiente. Confirman: un toast de éxito ("Guardado", "Cobro registrado"), el cierre del formulario/diálogo, el registro apareciendo en la lista, o el estado pendiente que pasó a resuelto (un saldo "Impaga" que quedó saldado). NUNCA hagas finish en el MISMO turno en que confirmaste: emití la acción, y en el turno siguiente MIRÁ el resultado antes de cerrar. Si tras confirmar el diálogo sigue abierto o el estado pendiente persiste igual, la acción NO tomó efecto — no declares éxito: seguí operando (revisá qué falta, reintentá, o esperá con wait). Un finish que afirma algo que la pantalla no confirma es un error grave: preferí seguir actuando antes que mentir el resultado.

ALCANCE: operás CUALQUIER módulo que el usuario tenga instalado — te guiás por los MENÚS disponibles y por la pantalla observada, sin asumir un dominio fijo. Si el objetivo no se puede lograr con los menús/controles visibles (el módulo no está, la vista no existe), respondé con finish explicándolo con claridad.

ESTRATEGIA GENERAL: entendé el objetivo → identificá en los MENÚS la vista destino y navegá → si hace falta crear algo, buscá el botón de alta ("Nuevo…", "Agregar…", "Registrar…") → completá los campos del formulario en orden (los pickers de búsqueda como paciente/cliente/producto se eligen con select) → confirmá con el botón de guardar → finish.`;

function renderControl(c: ScreenControl): string {
  const parts = [`  - [${c.ref}] (${c.kind}) ${c.name || '(sin nombre)'}`];
  if (c.value) parts.push(`= "${c.value}"`);
  if (c.state) parts.push(`[${c.state}]`);
  if (c.placeholder) parts.push(`placeholder:"${c.placeholder}"`);
  if (c.options && c.options.length > 0) {
    const opts = c.options.map((o) => (o.selected ? `*${o.label}*` : o.label)).join(', ');
    parts.push(`opciones: ${opts}`);
  }
  return parts.join(' ');
}

/** Menús navegables (los que tienen viewId; el resto no se puede abrir). */
function renderMenus(menus: ObservedScreen['menus']): string[] {
  const navegables = menus.filter((m) => m.viewId);
  if (navegables.length === 0) return [];
  return ['\nMENÚS (navigate):', ...navegables.map((m) => `  - ${m.path} → viewId: ${m.viewId}`)];
}

function renderScreen(screen: ObservedScreen): string {
  const lines: string[] = [];
  lines.push(
    `Vista activa: ${screen.viewTitle ?? '(inicio)'} (viewId: ${screen.activeViewId ?? 'none'}, capa: ${screen.layer})`
  );

  lines.push(...renderMenus(screen.menus));

  // Separar por región: los filtros y las acciones de fila se listan aparte para
  // que el modelo no confunda un filtro con un campo de formulario (ver observador).
  const filters = screen.controls.filter((c) => c.region === 'filter');
  const rowActions = screen.controls.filter((c) => c.region === 'row-action');
  const main = screen.controls.filter((c) => c.region !== 'filter' && c.region !== 'row-action');

  if (main.length > 0) {
    lines.push('\nCONTROLES (botones de acción y campos de formulario):');
    for (const c of main) lines.push(renderControl(c));
  }

  if (filters.length > 0) {
    lines.push(
      '\nFILTROS (SOLO acotan lo que se ve en la lista de abajo — NO crean, guardan ni dan de alta nada; para crear algo NO uses estos):'
    );
    for (const c of filters) lines.push(renderControl(c));
  }

  if (rowActions.length > 0) {
    lines.push('\nACCIONES POR FILA (operan sobre una fila puntual de la tabla):');
    for (const c of rowActions) lines.push(renderControl(c));
  }

  for (const table of screen.tables) lines.push(...renderTable(table));

  lines.push(...renderFigures(screen.figures));

  if (screen.notices?.length) {
    lines.push('\nAVISOS RECIENTES (toasts de los últimos segundos — feedback de tus acciones):');
    for (const n of screen.notices) lines.push(`  - ${n}`);
  }

  return lines.join('\n');
}

/**
 * Gráficos visibles. Son informativos: se listan para que el modelo pueda
 * RESPONDER sobre lo que el usuario está mirando, no para que intente operarlos.
 */
function renderFigures(figures: ObservedScreen['figures']): string[] {
  if (!figures?.length) return [];
  return [
    '\nGRÁFICOS (datos que el usuario está viendo; son informativos: no se clickean ni se editan):',
    ...figures.map((f) => `  - ${f.name}: ${f.description}`),
  ];
}

function renderTable(table: ObservedScreen['tables'][number]): string[] {
  const title = table.name ? ` «${table.name}»` : '';
  if (table.rows.length === 0) return [`\nTABLA${title}: (sin registros)`];
  const more = table.truncated ? ' (hay más filas, paginá/buscá)' : '';
  return [
    `\nTABLA${title} (columnas: ${table.columns.join(' | ')})${more}:`,
    ...table.rows.map((row) => `  - [${row.ref}] ${row.cells.join(' | ')}`),
  ];
}

function renderConversation(conversation: TurnRequest['conversation']): string {
  if (!conversation || conversation.length === 0) return '';
  const lines = conversation
    .slice(-10)
    .map((c, i) => `  ${i + 1}. Objetivo: "${c.goal}" → Resultado: ${c.outcome}`)
    .join('\n');
  return [
    '',
    'CONVERSACIÓN PREVIA (tareas que ya completaste en esta sesión de chat):',
    lines,
    'Usá este contexto para resolver referencias del nuevo objetivo (ej. "ese contacto", "la que acabo de crear", "ahora ponele…"). Si el objetivo nuevo depende de algo de acá, asumilo.',
    '',
  ].join('\n');
}

function renderHistory(history: TurnRecord[]): string {
  if (history.length === 0) return '(todavía no hiciste nada)';
  return history
    .slice(-10)
    .map((h, i) => {
      const base = `  ${i + 1}. ${h.thought} → ${JSON.stringify(h.action)}`;
      return h.error ? `${base}  ⚠️ FALLÓ: ${h.error}` : base;
    })
    .join('\n');
}

/**
 * BASE / PROTOCOLO efectivo: override del dev panel si existe, si no el default.
 * Es la mecánica genérica del copiloto (JSON, kinds, pickers…), propiedad del
 * ai-copilot — NO depende del negocio.
 */
export function getEffectivePrompt(): string {
  return getPromptOverride() ?? SYSTEM_PROMPT;
}

/**
 * Compone el prompt del sistema: BASE_PROTOCOL (mecánica) + CONTEXTO DE NEGOCIO
 * (el kit activo del tenant, si aporta uno). El contexto de negocio se **anexa**
 * a la base — no la reemplaza — para que un fix de la mecánica no haya que
 * replicarlo en cada kit. Ver `Investigaciones/copilot-system-prompt-por-kit.md`.
 */
export function composeSystemPrompt(businessContext?: string | null): string {
  const base = getEffectivePrompt();
  const context = businessContext?.trim();
  if (!context) return base;
  return [
    base,
    '',
    'CONTEXTO DEL NEGOCIO (el rubro donde operás; usalo para interpretar el objetivo, los nombres y el flujo típico):',
    context,
  ].join('\n');
}

/** Fecha de hoy legible + ISO, para que el modelo resuelva fechas relativas. */
function todayLine(): string {
  const now = new Date();
  const iso = now.toISOString().slice(0, 10);
  let legible = iso;
  try {
    legible = now.toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    // Sin ICU: nos quedamos con el ISO.
  }
  return `FECHA DE HOY: ${iso} (${legible}). Usala para resolver fechas relativas del objetivo ("hoy", "mañana", "la semana/el mes que viene", "en 3 días", etc.). Las fechas van SIEMPRE en formato AAAA-MM-DD.`;
}

export function buildMessages(req: TurnRequest, businessContext?: string | null): ChatMessage[] {
  const user = [
    renderConversation(req.conversation),
    todayLine(),
    `OBJETIVO DEL USUARIO: ${req.goal}`,
    '',
    'ACCIONES QUE YA REALIZASTE (en esta tarea):',
    renderHistory(req.history),
    '',
    'PANTALLA ACTUAL:',
    renderScreen(req.screen),
    '',
    'Decidí la PRÓXIMA acción y respondé solo con el JSON { "thought", "action" }.',
  ].join('\n');

  return [
    { role: 'system', content: composeSystemPrompt(businessContext) },
    { role: 'user', content: user },
  ];
}
