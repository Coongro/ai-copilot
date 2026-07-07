/**
 * GET/PUT /config/prompt  (auth: 'none', pero SOLO operativo en modo dev)
 *
 * Herramienta de desarrollo: leer y ajustar el system prompt del copiloto desde
 * el dev panel sin recompilar ni reiniciar. En producción `isDevMode()` es false
 * y la escritura se niega — ahí manda el SYSTEM_PROMPT por defecto.
 *
 * URL final: /api/plugins/ai-copilot/config/prompt
 */

import { clearPromptOverride, isDevMode, setPromptOverride } from '../config-store.js';
import { SYSTEM_PROMPT, getEffectivePrompt } from '../prompt.js';

export interface PromptConfigResponse {
  /** false en producción: el prompt NO es editable. */
  dev: boolean;
  /** Prompt efectivo (override si existe, si no el default). */
  prompt: string;
  /** true si el efectivo es el default (no hay override activo). */
  isDefault: boolean;
  /** Prompt por defecto, para poder restablecer desde la UI. */
  defaultPrompt: string;
}

function snapshot(): PromptConfigResponse {
  const prompt = getEffectivePrompt();
  return {
    dev: isDevMode(),
    prompt,
    isDefault: prompt === SYSTEM_PROMPT,
    defaultPrompt: SYSTEM_PROMPT,
  };
}

export function getPrompt(): PromptConfigResponse {
  return snapshot();
}

interface SetPromptBody {
  prompt?: string;
  reset?: boolean;
}

export function setPrompt(ctx: { body: unknown }): PromptConfigResponse {
  if (!isDevMode()) {
    throw new Error(
      'El prompt del copiloto solo puede editarse en modo desarrollo. En producción usa el valor por defecto.'
    );
  }
  const body = (ctx.body ?? {}) as SetPromptBody;

  if (body.reset) {
    clearPromptOverride();
  } else if (typeof body.prompt === 'string') {
    setPromptOverride(body.prompt);
  }
  return snapshot();
}
