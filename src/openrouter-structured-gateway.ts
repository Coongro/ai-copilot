/** Una sola fuente de configuración: el plugin OpenRouter activo en la API. */

import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  IntelligenceLevel,
} from '@coongro/openrouter/server';

const PORT = process.env.PORT?.trim() || '3000';
const API_URL = process.env.INTERNAL_API_URL?.trim() || `http://127.0.0.1:${PORT}/api`;
const ENDPOINT = `${API_URL.replace(/\/$/, '')}/plugins/openrouter/developer/structured`;

function headers() {
  const token = process.env.COONGRO_BUILDER_AI_TOKEN?.trim();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Coongro-Builder-Token': token } : {}),
  };
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const data: unknown = await response.json().catch(() => ({}));
  const record =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  if (!response.ok) {
    const genericError =
      typeof record.error === 'string' && record.error !== 'Internal Server Error'
        ? record.error
        : null;
    const message =
      (typeof record.message === 'string' ? record.message : null) ??
      genericError ??
      `OpenRouter gateway respondió ${response.status}`;
    const error = new Error(message) as Error & { code?: string; statusCode?: number };
    error.code = 'OPENROUTER_GATEWAY_ERROR';
    error.statusCode = response.status;
    throw error;
  }

  return data as T;
}

export async function openRouterStructuredStatus(): Promise<{
  dev: boolean;
  configured: boolean;
  models: Record<IntelligenceLevel, string>;
}> {
  return jsonResponse<{
    dev: boolean;
    configured: boolean;
    models: Record<IntelligenceLevel, string>;
  }>(await fetch(ENDPOINT, { headers: headers() }));
}

export async function callOpenRouterStructured(
  options: ChatCompletionOptions & { level: IntelligenceLevel }
): Promise<ChatCompletionResult> {
  return jsonResponse<ChatCompletionResult>(
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(options),
    })
  );
}
