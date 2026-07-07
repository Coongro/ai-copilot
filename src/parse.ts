/**
 * Extracción y validación de la respuesta del LLM, dirigida por una tabla de
 * specs (verbo → validador). Recupera el primer objeto JSON balanceado aunque
 * venga con ```fences``` o texto, y normaliza cada acción a su forma esperada.
 */

import type { AgentAction, TurnResponse } from './types.js';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

type Spec = (a: Record<string, unknown>) => AgentAction;

const SPECS: Record<string, Spec> = {
  navigate: (a) => {
    const viewId = str(a.viewId);
    if (!viewId) throw new Error('navigate requiere viewId');
    return { type: 'navigate', viewId };
  },
  click: (a) => {
    const ref = str(a.ref);
    if (!ref) throw new Error('click requiere ref');
    return { type: 'click', ref };
  },
  type: (a) => {
    const ref = str(a.ref);
    if (!ref) throw new Error('type requiere ref');
    return { type: 'type', ref, text: typeof a.text === 'string' ? a.text : '' };
  },
  select: (a) => {
    const ref = str(a.ref);
    if (!ref) throw new Error('select requiere ref');
    return { type: 'select', ref, option: str(a.option) ?? '' };
  },
  toggle: (a) => {
    const ref = str(a.ref);
    if (!ref) throw new Error('toggle requiere ref');
    return { type: 'toggle', ref, on: typeof a.on === 'boolean' ? a.on : undefined };
  },
  expand: (a) => {
    const ref = str(a.ref);
    if (!ref) throw new Error('expand requiere ref');
    return { type: 'expand', ref };
  },
  setNumber: (a) => {
    const ref = str(a.ref);
    if (!ref) throw new Error('setNumber requiere ref');
    const value = Number(a.value);
    if (!Number.isFinite(value)) throw new Error('setNumber requiere value numérico');
    return { type: 'setNumber', ref, value };
  },
  pickDate: (a) => {
    const ref = str(a.ref);
    const date = str(a.date);
    if (!ref || !date) throw new Error('pickDate requiere ref y date');
    return { type: 'pickDate', ref, date };
  },
  wait: (a) => ({ type: 'wait', ms: typeof a.ms === 'number' ? a.ms : 600 }),
  finish: (a) => ({ type: 'finish', summary: str(a.summary) ?? 'Listo.' }),
};

export const ACTION_VERBS = Object.keys(SPECS);

function validateAction(raw: unknown): AgentAction {
  if (typeof raw !== 'object' || raw === null) throw new Error('action no es un objeto');
  const a = raw as Record<string, unknown>;
  const spec = typeof a.type === 'string' ? SPECS[a.type] : undefined;
  if (!spec) throw new Error(`action.type inválido: ${String(a.type)}`);
  return spec(a);
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence ? fence[1].trim() : trimmed;
}

export function parseTurn(content: string): TurnResponse {
  const body = stripFences(content);
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`Respuesta sin JSON detectable: ${content.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch (e) {
    throw new Error(`JSON inválido del modelo: ${(e as Error).message}`);
  }
  const obj = parsed as Record<string, unknown>;
  return {
    thought: typeof obj.thought === 'string' ? obj.thought : '',
    action: validateAction(obj.action),
  };
}
