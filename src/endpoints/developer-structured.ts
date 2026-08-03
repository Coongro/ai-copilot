/** API interna de desarrollo consumida por Coongro View Builder. */

import { isDevMode } from '../config-store.js';
import {
  completeStructured,
  structuredServiceStatus,
  type StructuredCompletionRequest,
} from '../structured-completion.js';

function assertDeveloperAccess(headers: Record<string, string>): void {
  if (!isDevMode()) {
    const error = new Error(
      'La resolución IA del Builder solo está disponible en desarrollo.'
    ) as Error & {
      statusCode?: number;
    };
    error.statusCode = 404;
    throw error;
  }
  const expected = process.env.COONGRO_BUILDER_AI_TOKEN?.trim();
  const actual = headers['x-coongro-builder-token'] ?? headers['X-Coongro-Builder-Token'];
  if (expected && actual !== expected) {
    const error = new Error('Credencial interna del Builder inválida.') as Error & {
      statusCode?: number;
    };
    error.statusCode = 401;
    throw error;
  }
}

export async function developerStructuredStatus(ctx: { headers: Record<string, string> }) {
  assertDeveloperAccess(ctx.headers ?? {});
  return { dev: true, ...(await structuredServiceStatus()) };
}

export async function developerStructured(ctx: { body: unknown; headers: Record<string, string> }) {
  assertDeveloperAccess(ctx.headers ?? {});
  return completeStructured((ctx.body ?? {}) as StructuredCompletionRequest);
}
