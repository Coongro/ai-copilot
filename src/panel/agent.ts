/**
 * Loop del agente (lado panel).
 *
 * Patrón "agéntico puro": cobrar la tarea → observar → preguntarle al LLM la
 * próxima acción → ejecutarla con animación → narrar → repetir, hasta `finish`
 * o el tope de pasos. El usuario ve cada paso en el chat y la UI moviéndose.
 */

import { act, clearHighlight } from './actuator.js';
import { consumeCredit, requestTurn } from './api.js';
import { AI_REF_ATTR, observe } from './screen-reader.js';
import { copilotStore } from './store.js';
import type { AgentAction, IntelligenceLevel, TurnRecord, TurnResponse } from './types.js';

const MAX_STEPS = 28;
const STEP_PAUSE_MS = 450;

function labelOf(ref: string): string {
  const el = document.querySelector<HTMLElement>(`[${AI_REF_ATTR}="${CSS.escape(ref)}"]`);
  if (!el) return ref;
  const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (t) return t;
  const input =
    el instanceof HTMLInputElement ? el : el.querySelector<HTMLInputElement>('input, textarea');
  return el.getAttribute('aria-label') ?? input?.placeholder ?? ref;
}

/** Texto humano para narrar la acción en el chat. */
function describeAction(action: AgentAction): string {
  switch (action.type) {
    case 'navigate':
      return `🧭 Navegando a la vista «${action.viewId}»`;
    case 'click':
      return `🖱️ Click en «${labelOf(action.ref)}»`;
    case 'type':
      return `⌨️ Escribiendo en «${labelOf(action.ref)}»: "${action.text}"`;
    case 'select':
      return action.option
        ? `🔽 Eligiendo «${action.option}» en «${labelOf(action.ref)}»`
        : `🔽 Eligiendo la primera opción en «${labelOf(action.ref)}»`;
    case 'toggle':
      return `🔘 ${action.on === false ? 'Desactivando' : 'Activando'} «${labelOf(action.ref)}»`;
    case 'expand':
      return `⬇️ Desplegando «${labelOf(action.ref)}»`;
    case 'setNumber':
      return `🔢 Poniendo ${action.value} en «${labelOf(action.ref)}»`;
    case 'pickDate':
      return `📅 Eligiendo «${action.date}» en «${labelOf(action.ref)}»`;
    case 'wait':
      return `⏳ Esperando…`;
    case 'finish':
      return action.summary;
  }
}

/**
 * Cobra UNA tarea antes de arrancar el loop. Devuelve true si se puede seguir.
 * En cualquier caso deja el saldo del store sincronizado con el servidor.
 */
async function chargeTask(level: IntelligenceLevel): Promise<boolean> {
  try {
    const credit = await consumeCredit(level);
    // El saldo mostrado siempre viene del servidor (ledger), nunca se estima
    // en el cliente — así el número es exacto tras cada cobro.
    copilotStore.setBalance(credit.balance);
    if (!credit.ok) {
      copilotStore.addMessage(
        'assistant',
        'error',
        credit.error ??
          'No te quedan Unidades de trabajo. Recargá desde tu cuenta de Coongro para seguir usando el asistente.'
      );
      copilotStore.setStatus('error');
      return false;
    }
    return true;
  } catch (e) {
    copilotStore.addMessage(
      'assistant',
      'error',
      `No pude verificar tus Unidades de trabajo: ${(e as Error).message}`
    );
    copilotStore.setStatus('error');
    return false;
  }
}

export async function runAgent(goal: string, level: IntelligenceLevel): Promise<void> {
  copilotStore.clearAbort();
  copilotStore.setRunning(true);
  copilotStore.setStatus('thinking');

  const history: TurnRecord[] = [];

  try {
    // Cobro de la tarea ANTES de arrancar: si no hay saldo, no corremos el loop.
    if (!(await chargeTask(level))) return;

    // Memoria conversacional de la sesión (tareas previas) — da continuidad a
    // referencias como "ese contacto" o "ahora ponele…".
    const conversation = copilotStore.getSnapshot().conversation;

    for (let step = 0; step < MAX_STEPS; step++) {
      if (copilotStore.getSnapshot().abortRequested) {
        copilotStore.addMessage('assistant', 'text', '⏹️ Me detuve a pedido tuyo.');
        copilotStore.addConversationEntry(goal, 'Interrumpida por el usuario antes de terminar.');
        copilotStore.setStatus('idle');
        return;
      }

      copilotStore.setStatus('thinking');
      const screen = await observe();

      let turn: TurnResponse;
      try {
        turn = await requestTurn({ goal, screen, history, level, conversation });
      } catch (e) {
        copilotStore.addMessage(
          'assistant',
          'error',
          `Error consultando la IA: ${(e as Error).message}`
        );
        copilotStore.setStatus('error');
        return;
      }

      if (turn.thought) copilotStore.addMessage('assistant', 'thought', turn.thought);

      if (turn.action.type === 'finish') {
        const summary = turn.action.summary || 'Listo ✅';
        copilotStore.addMessage('assistant', 'done', summary);
        copilotStore.addConversationEntry(goal, summary);
        copilotStore.setStatus('done');
        clearHighlight();
        return;
      }

      copilotStore.addMessage('assistant', 'action', describeAction(turn.action));
      copilotStore.setStatus('acting');
      let actionError: string | undefined;
      try {
        await act(turn.action);
      } catch (e) {
        actionError = (e as Error).message;
        copilotStore.addMessage(
          'assistant',
          'error',
          `No pude ejecutar la acción (${turn.action.type}): ${actionError}`
        );
      }

      // Guardamos el error en el historial para que el LLM lo vea y se recupere.
      history.push({ thought: turn.thought, action: turn.action, error: actionError });
      await new Promise((r) => setTimeout(r, STEP_PAUSE_MS));
    }

    copilotStore.addMessage('assistant', 'text', 'Llegué al límite de pasos de esta tarea.');
    copilotStore.addConversationEntry(goal, 'No se completó: se alcanzó el límite de pasos.');
    copilotStore.setStatus('idle');
  } finally {
    clearHighlight();
    copilotStore.setRunning(false);
  }
}
