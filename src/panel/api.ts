/**
 * Cliente HTTP del panel. El copiloto observa la pantalla y le pide al cerebro
 * (`/plugins/ai-copilot/turn`) la próxima acción. El cobro por tarea y el saldo
 * pasan por el gateway openrouter. Auth por cookie (credentials:include).
 */

import { apiBaseUrl } from './bridge.js';
import type {
  ConversationEntry,
  IntelligenceLevel,
  ObservedScreen,
  TurnRecord,
  TurnResponse,
} from './types.js';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let payload: unknown;
  try {
    payload = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  if (!res.ok) {
    const err = (payload as { error?: string; message?: string }) ?? {};
    const message =
      err.error ?? err.message ?? (typeof payload === 'string' ? payload : res.statusText);
    throw new Error(message || `Error ${res.status}`);
  }
  return payload as T;
}

interface TurnRequest {
  goal: string;
  screen: ObservedScreen;
  history: TurnRecord[];
  level: IntelligenceLevel;
  /** Tareas previas de la sesión de chat (continuidad entre mensajes). */
  conversation: ConversationEntry[];
}

export async function requestTurn(req: TurnRequest): Promise<TurnResponse> {
  return postJson<TurnResponse>('/plugins/ai-copilot/turn', req);
}

export interface ConsumeResult {
  ok: boolean;
  balance: number;
  error?: string;
}

/** Cobra UNA tarea del asistente (descuenta unidades del nivel elegido). */
export async function consumeCredit(level: IntelligenceLevel): Promise<ConsumeResult> {
  return postJson<ConsumeResult>('/plugins/openrouter/credits/consume', {
    level,
    source: 'ai-copilot',
  });
}

export interface BalanceResponse {
  balance: number;
  taskCost: Record<IntelligenceLevel, number>;
}

export async function fetchBalance(): Promise<BalanceResponse> {
  const res = await fetch(`${apiBaseUrl()}/plugins/openrouter/credits/balance`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`No pude leer el saldo (${res.status}).`);
  return (await res.json()) as BalanceResponse;
}
