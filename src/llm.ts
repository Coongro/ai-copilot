/**
 * Acceso al LLM.
 *
 * PRIMARIO: delega en el plugin @coongro/openrouter (POST /chat) via una
 * llamada server-to-server dentro del mismo proceso de la API, reenviando la
 * cookie de sesión del usuario. Así el "motor LLM" vive en un único plugin
 * reutilizable y el ai-copilot solo aporta el cerebro.
 *
 * FALLBACK: si el self-call falla (cookie, plugin no instalado, etc.), llama a
 * OpenRouter directamente con la misma env key, para que la demo no se caiga.
 */

import type { ChatMessage } from './types.js';

const PORT = process.env.PORT?.trim() || '3000';
const INTERNAL_API_URL = process.env.INTERNAL_API_URL?.trim() || `http://127.0.0.1:${PORT}/api`;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-3.5-sonnet';

function getCookie(headers: Record<string, string>): string | undefined {
  return headers.cookie ?? headers.Cookie;
}

/** Intenta via el plugin openrouter. Devuelve null si no se pudo (para hacer fallback). */
async function viaOpenRouterPlugin(
  messages: ChatMessage[],
  headers: Record<string, string>,
  level?: string
): Promise<string | null> {
  try {
    const cookie = getCookie(headers);
    const res = await fetch(`${INTERNAL_API_URL}/plugins/openrouter/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ messages, level }),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ai-copilot] plugin openrouter respondió ${res.status} — uso fallback directo.`
      );
      return null;
    }
    const data = (await res.json()) as { content?: string };
    return typeof data.content === 'string' ? data.content : null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[ai-copilot] self-call al plugin openrouter falló, uso fallback directo:', e);
    return null;
  }
}

/** Llama OpenRouter directamente (fallback). */
async function directOpenRouter(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY no configurada en el servidor (.env.docker).');
  }
  const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_REFERER?.trim() || 'https://coongro.local',
      'X-Title': process.env.OPENROUTER_TITLE?.trim() || 'Coongro AI Copilot',
    },
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter respondió ${res.status}: ${detail.slice(0, 500)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

export async function callLLM(
  messages: ChatMessage[],
  headers: Record<string, string>,
  level?: string
): Promise<string> {
  const viaPlugin = await viaOpenRouterPlugin(messages, headers, level);
  if (viaPlugin !== null) return viaPlugin;
  // Fallback directo: el nivel se ignora (el mapeo vive en el gateway).
  return directOpenRouter(messages);
}
