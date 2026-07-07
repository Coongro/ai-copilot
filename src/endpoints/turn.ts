/**
 * POST /turn
 *
 * El "cerebro" del copiloto: recibe el objetivo + la pantalla observada + el
 * historial, le pregunta al LLM (via plugin openrouter) la próxima acción, y la
 * devuelve validada como `{ thought, action }`.
 *
 * URL final: POST /api/plugins/ai-copilot/turn
 */

import { callLLM } from '../llm.js';
import { parseTurn } from '../parse.js';
import { buildMessages } from '../prompt.js';
import type { TurnRequest, TurnResponse } from '../types.js';

import type { JwtContext } from './_context.js';

const RETRY_HINT =
  'Tu respuesta anterior no fue un JSON válido. Respondé SOLO con un objeto JSON ' +
  '{ "thought": "...", "action": { "type": "..." , ... } } sin texto ni markdown.';

function isTurnRequest(body: unknown): body is TurnRequest {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.goal === 'string' && typeof b.screen === 'object' && b.screen !== null;
}

export async function turn(ctx: JwtContext): Promise<TurnResponse> {
  if (!ctx.user?.tenantId) {
    throw new Error('Endpoint requiere autenticación.');
  }
  if (!isTurnRequest(ctx.body)) {
    throw new Error('Body requiere { goal, screen, history }.');
  }
  const level =
    ctx.body.level === 'fast' || ctx.body.level === 'advanced' ? ctx.body.level : 'standard';
  const req: TurnRequest = {
    goal: ctx.body.goal,
    screen: ctx.body.screen,
    history: Array.isArray(ctx.body.history) ? ctx.body.history : [],
    level,
    conversation: Array.isArray(ctx.body.conversation) ? ctx.body.conversation : [],
  };

  // Contexto de negocio del kit activo del tenant (server-side, lazy). Un fallo
  // acá no debe tumbar el turno: el copiloto opera igual con solo la BASE.
  let businessContext: string | null = null;
  try {
    businessContext = (await ctx.resolveCopilotContext?.()) ?? null;
  } catch {
    businessContext = null;
  }

  const messages = buildMessages(req, businessContext);
  const first = await callLLM(messages, ctx.headers, level);

  try {
    return parseTurn(first);
  } catch {
    // Un reintento con corrección explícita antes de rendirnos.
    const repaired = await callLLM(
      [...messages, { role: 'assistant', content: first }, { role: 'user', content: RETRY_HINT }],
      ctx.headers,
      level
    );
    try {
      return parseTurn(repaired);
    } catch (e) {
      // No matamos la corrida por un parseo fallido: reintentamos en el próximo
      // turno (el modelo suele acertar al re-pedirle con la misma pantalla).
      return {
        thought: `No pude interpretar la respuesta del modelo (${(e as Error).message}); reintento.`,
        action: { type: 'wait', ms: 500 },
      };
    }
  }
}
