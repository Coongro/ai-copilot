/**
 * @coongro/ai-copilot — Exportaciones server-only
 *
 * Schema tables y repositories (dependen de drizzle-orm).
 * NO importar desde el browser — usar '@coongro/ai-copilot' para hooks/componentes.
 */
export {
  completeStructured,
  structuredServiceStatus,
  structuredValueProblems,
} from './structured-completion.js';
export type {
  StructuredCompletionRequest,
  StructuredCompletionResponse,
} from './structured-completion.js';
