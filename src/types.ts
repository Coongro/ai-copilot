/**
 * Contrato del agente (lado plugin) — modelo ARIA-first. Espeja
 * apps/web/src/features/copilot/types.ts.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

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

export interface ObservedScreen {
  activeViewId: string | null;
  viewTitle: string | null;
  layer: 'main' | 'dialog' | 'popover';
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
  /** Mensaje de error si la acción falló (para que el LLM pueda recuperarse). */
  error?: string;
}

/** Nivel de inteligencia — el gateway openrouter lo mapea a modelo. */
export type IntelligenceLevel = 'fast' | 'standard' | 'advanced';

/** Resumen de una tarea previa de la MISMA sesión de chat (memoria conversacional). */
export interface ConversationEntry {
  goal: string;
  outcome: string;
}

export interface TurnRequest {
  goal: string;
  screen: ObservedScreen;
  history: TurnRecord[];
  /** Nivel elegido por el usuario (default 'standard' si se omite). */
  level?: IntelligenceLevel;
  /**
   * Tareas previas de la sesión de chat (se resetea al iniciar un chat nuevo).
   * Da continuidad: el modelo resuelve referencias como "ese contacto" o
   * "ahora ponele…" mirando lo que ya hizo antes.
   */
  conversation?: ConversationEntry[];
}

export interface TurnResponse {
  thought: string;
  action: AgentAction;
}
