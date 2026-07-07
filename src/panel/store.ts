/**
 * Store externo mínimo del copiloto (sin zustand — el import map de plugins no
 * lo expone). Patrón getSnapshot + subscribe para consumir con
 * React.useSyncExternalStore desde el host React.
 */

import type {
  ConversationEntry,
  CopilotMessage,
  CopilotStatus,
  IntelligenceLevel,
  MessageKind,
} from './types.js';

export interface CopilotState {
  isOpen: boolean;
  status: CopilotStatus;
  running: boolean;
  /** Bandera que el loop del agente chequea para abortar entre pasos. */
  abortRequested: boolean;
  messages: CopilotMessage[];
  /**
   * Memoria conversacional: resúmenes de tareas ya hechas en esta sesión de
   * chat. Persiste entre mensajes y se limpia al iniciar un chat nuevo (reset).
   */
  conversation: ConversationEntry[];
  /** Saldo de Unidades de trabajo; null = aún no cargado. */
  balance: number | null;
  /** Costo en unidades por tarea, por nivel (para mostrar en la UI). */
  taskCost: Record<IntelligenceLevel, number> | null;
}

const listeners = new Set<() => void>();

let state: CopilotState = {
  isOpen: false,
  status: 'idle',
  running: false,
  abortRequested: false,
  messages: [],
  conversation: [],
  balance: null,
  taskCost: null,
};

/** Tope de tareas recordadas por sesión de chat (evita crecer sin límite). */
const MAX_CONVERSATION = 20;

let messageSeq = 0;

function set(patch: Partial<CopilotState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

// Referencias estables (no métodos) para React.useSyncExternalStore — evita
// re-suscripciones por identidad cambiante y el warning de unbound-method.
export const getSnapshot = (): CopilotState => state;
export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const copilotStore = {
  getSnapshot,
  subscribe,
  open(): void {
    set({ isOpen: true });
  },
  close(): void {
    set({ isOpen: false });
  },
  addMessage(role: CopilotMessage['role'], kind: MessageKind, text: string): void {
    messageSeq += 1;
    set({ messages: [...state.messages, { id: `cp-${messageSeq}`, role, kind, text }] });
  },
  /** Registra el resultado de una tarea para dar continuidad a las siguientes. */
  addConversationEntry(goal: string, outcome: string): void {
    set({ conversation: [...state.conversation, { goal, outcome }].slice(-MAX_CONVERSATION) });
  },
  setStatus(status: CopilotStatus): void {
    set({ status });
  },
  setBalance(balance: number, taskCost?: Record<IntelligenceLevel, number>): void {
    set(taskCost ? { balance, taskCost } : { balance });
  },
  setRunning(running: boolean): void {
    set({ running });
  },
  requestAbort(): void {
    set({ abortRequested: true });
  },
  clearAbort(): void {
    set({ abortRequested: false });
  },
  /** Chat nuevo: borra los mensajes Y la memoria conversacional. */
  reset(): void {
    set({ messages: [], conversation: [], status: 'idle', running: false, abortRequested: false });
  },
};
