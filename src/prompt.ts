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

CADA CONTROL TIENE UN kind. Usá el verbo que le corresponde:
- kind "button"     → { "type": "click", "ref": "<ref>" }           (botones, links, filas de tabla)
- kind "text"       → { "type": "type", "ref": "<ref>", "text": "<texto>" }
- kind "number"     → { "type": "setNumber", "ref": "<ref>", "value": <número> }
- kind "toggle"     → { "type": "toggle", "ref": "<ref>", "on": true|false }   (checkbox/switch; on opcional)
- kind "choice"     → { "type": "select", "ref": "<ref>", "option": "<etiqueta>" }  (radios/tabs; muestra sus opciones inline)
- kind "select"     → { "type": "select", "ref": "<ref>", "option": "<texto a buscar>" }  (combobox; opciones no visibles hasta abrir; option vacío "" = primera disponible; no inventes nombres que no estén en el objetivo)
- kind "date"       → { "type": "pickDate", "ref": "<ref>", "date": "YYYY-MM-DD" o "YYYY-MM-DDTHH:MM" }
- kind "expandable" → { "type": "expand", "ref": "<ref>" }   (abre una sección colapsada; luego re-observás los campos nuevos)
- Genéricos: { "type": "wait", "ms": 600 } y { "type": "finish", "summary": "<resumen>" }.

NOTAS:
- Aprovechá el estado: si un control ya tiene el "value" correcto o el state "checked"/"selected"/"expanded" que querés, NO lo repitas — pasá al siguiente.
- PICKERS DE BÚSQUEDA (paciente, mascota, profesional, veterinario, contacto): después de elegir, el campo se convierte en un "chip" con el nombre y DESAPARECE de la lista de controles. Eso significa que YA quedó seleccionado: NO lo vuelvas a elegir, NO busques otro campo para lo mismo, NO intentes borrarlo — pasá directo al siguiente campo.
- En general, si un campo que completaste deja de aparecer, asumí que quedó bien y seguí.
- Si hay opciones inline (choice) elegí por su etiqueta exacta.
- RECUPERACIÓN: si en el historial la acción anterior dice "⚠️ FALLÓ", NO la repitas igual. Probá otra cosa (otro ref, otro valor/opción, expandí una sección, o esperá con wait); si realmente no se puede, hacé finish explicando.
- Si la tabla indica que hay más filas, usá la búsqueda o paginá en vez de asumir que el registro no está.
- FINALIZÁ con finish cuando el objetivo esté cumplido: tras guardar un registro la pantalla cambia (vuelve a la lista o abre el detalle) y el formulario/diálogo desaparece. No sigas actuando después de eso.

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

function renderScreen(screen: ObservedScreen): string {
  const lines: string[] = [];
  lines.push(
    `Vista activa: ${screen.viewTitle ?? '(inicio)'} (viewId: ${screen.activeViewId ?? 'none'}, capa: ${screen.layer})`
  );

  if (screen.menus.length > 0) {
    lines.push('\nMENÚS (navigate):');
    for (const m of screen.menus) if (m.viewId) lines.push(`  - ${m.path} → viewId: ${m.viewId}`);
  }

  if (screen.controls.length > 0) {
    lines.push('\nCONTROLES:');
    for (const c of screen.controls) lines.push(renderControl(c));
  }

  if (screen.table && screen.table.rows.length > 0) {
    const more = screen.table.truncated ? ' (hay más filas, paginá/buscá)' : '';
    lines.push(`\nTABLA (columnas: ${screen.table.columns.join(' | ')})${more}:`);
    for (const row of screen.table.rows) lines.push(`  - [${row.ref}] ${row.cells.join(' | ')}`);
  } else if (screen.table) {
    lines.push('\nTABLA: (sin registros)');
  }

  return lines.join('\n');
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

export function buildMessages(req: TurnRequest, businessContext?: string | null): ChatMessage[] {
  const user = [
    renderConversation(req.conversation),
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
