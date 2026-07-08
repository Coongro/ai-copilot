/**
 * Contrato del copiloto (lado panel/frontend) — modelo ARIA-first.
 * Espeja los tipos del backend (src/types.ts) más los del chat UI.
 */

export interface MenuItem {
  label: string;
  viewId: string | null;
  path: string;
}

export type ControlKind =
  | 'button'
  | 'text'
  | 'number'
  | 'toggle'
  | 'choice'
  | 'select'
  | 'date'
  | 'expandable'
  | 'unknown';

export interface ControlOption {
  label: string;
  selected?: boolean;
}

export interface ScreenControl {
  ref: string;
  kind: ControlKind;
  name: string;
  value?: string;
  state?: string;
  options?: ControlOption[];
  placeholder?: string;
  meta?: Record<string, string>;
  /**
   * Región semántica del control, para que el modelo distinga qué está mirando:
   * 'filter' (barra de filtros: solo acota la lista, no crea/guarda), 'row-action'
   * (acción sobre una fila de tabla). Ausente = control de contenido/formulario.
   */
  region?: 'filter' | 'row-action';
}

export interface ScreenTableRow {
  ref: string;
  cells: string[];
}

export interface ScreenTable {
  /** Caption o aria-label de la tabla (distingue tablas múltiples en una vista). */
  name?: string;
  columns: string[];
  rows: ScreenTableRow[];
  truncated?: boolean;
}

export type ScreenLayer = 'main' | 'dialog' | 'popover';

export interface ObservedScreen {
  activeViewId: string | null;
  viewTitle: string | null;
  layer: ScreenLayer;
  menus: MenuItem[];
  controls: ScreenControl[];
  /** TODAS las tablas visibles del scope (una vista puede tener varias). */
  tables: ScreenTable[];
  /** Toasts recientes (últimos 30 s): feedback efímero que el agente no llegaría a ver. */
  notices: string[];
}

export type AgentAction =
  | { type: 'navigate'; viewId: string }
  | { type: 'click'; ref: string }
  | { type: 'type'; ref: string; text: string }
  | { type: 'select'; ref: string; option: string }
  | { type: 'toggle'; ref: string; on?: boolean }
  | { type: 'expand'; ref: string; open?: boolean }
  | { type: 'setNumber'; ref: string; value: number }
  | { type: 'pickDate'; ref: string; date: string }
  | { type: 'wait'; ms?: number }
  | { type: 'finish'; summary: string };

export interface TurnRecord {
  thought: string;
  action: AgentAction;
  error?: string;
}

/** Resumen de una tarea previa de la MISMA sesión de chat (memoria conversacional). */
export interface ConversationEntry {
  goal: string;
  outcome: string;
}

export interface TurnResponse {
  thought: string;
  action: AgentAction;
}

export type IntelligenceLevel = 'fast' | 'standard' | 'advanced';

export type CopilotStatus = 'idle' | 'thinking' | 'acting' | 'done' | 'error';

export type MessageKind = 'text' | 'thought' | 'action' | 'done' | 'error';

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  kind: MessageKind;
  text: string;
}
