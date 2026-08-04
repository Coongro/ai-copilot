/**
 * Completion estructurada reutilizable para herramientas de desarrollo.
 *
 * ai-copilot concentra el protocolo del modelo (nivel, retry, circuit breaker
 * y validación). Los consumidores —por ejemplo View Builder— conservan sus
 * prompts, schemas y reglas de dominio.
 */

import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatMessage,
  IntelligenceLevel,
  StructuredOutputSchema,
} from '@coongro/openrouter/server';

import {
  callOpenRouterStructured,
  openRouterStructuredStatus,
} from './openrouter-structured-gateway.js';

const MAX_MESSAGES = 20;
/**
 * Techo de gasto por llamada, no límite del modelo (que admite bastante más).
 *
 * Estaba en 80 000 y lo movió un caso concreto: el agente ciego le pasa al
 * modelo el catálogo publicado del kit —86 capabilities, unos 70 000
 * caracteres solo en definiciones— y con lo que el runtime le agrega a cada
 * una (el `confirmationToken` de las escrituras, la paginación de las
 * colecciones) quedaba apenas por encima. No es que sobrara margen: faltaba
 * un 10 %.
 */
const MAX_PROMPT_CHARS = 150_000;
const MAX_SCHEMA_CHARS = 60_000;
const FAILURE_LIMIT = 3;
const COOLDOWN_MS = 30_000;
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

export interface StructuredCompletionRequest {
  messages: ChatMessage[];
  level?: IntelligenceLevel;
  responseSchema: StructuredOutputSchema;
  promptId: string;
  promptVersion: string;
  temperature?: number;
  maxTokens?: number;
  /** Los clasificadores usan none; prompts complejos pueden optar por otro esfuerzo. */
  reasoningEffort?: NonNullable<ChatCompletionOptions['reasoning']>['effort'];
  reasoningEnabled?: boolean;
}

export interface StructuredCompletionResponse {
  data: unknown;
  meta: {
    level: IntelligenceLevel;
    model: string;
    promptId: string;
    promptVersion: string;
    attempts: number;
    usage?: { promptTokens?: number; completionTokens?: number; reasoningTokens?: number };
  };
}

interface Dependencies {
  call: (
    options: ChatCompletionOptions & { level: IntelligenceLevel }
  ) => Promise<ChatCompletionResult>;
  now: () => number;
}

const defaults: Dependencies = { call: callOpenRouterStructured, now: Date.now };
let failures = 0;
let openUntil = 0;

function badRequest(message: string): Error {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 400;
  return error;
}

function validateRequest(request: StructuredCompletionRequest): void {
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw badRequest('messages debe ser un array no vacío.');
  }
  if (request.messages.length > MAX_MESSAGES)
    throw badRequest(`messages admite hasta ${MAX_MESSAGES} entradas.`);
  const promptChars = request.messages.reduce(
    (sum, message) => sum + (message.content?.length ?? 0),
    0
  );
  if (promptChars > MAX_PROMPT_CHARS)
    throw badRequest(`el prompt supera ${MAX_PROMPT_CHARS} caracteres.`);
  if (!request.promptId?.trim() || !request.promptVersion?.trim()) {
    throw badRequest('promptId y promptVersion son obligatorios.');
  }
  const schemaChars = JSON.stringify(request.responseSchema?.schema ?? {}).length;
  if (schemaChars > MAX_SCHEMA_CHARS)
    throw badRequest(`el schema supera ${MAX_SCHEMA_CHARS} caracteres.`);
  if (request.temperature !== undefined && (request.temperature < 0 || request.temperature > 1)) {
    throw badRequest('temperature debe estar entre 0 y 1.');
  }
  if (request.reasoningEffort && !REASONING_EFFORTS.has(request.reasoningEffort)) {
    throw badRequest('reasoningEffort no es válido.');
  }
  if (request.reasoningEnabled !== undefined && typeof request.reasoningEnabled !== 'boolean') {
    throw badRequest('reasoningEnabled debe ser boolean.');
  }
}

function typeMatches(value: unknown, type: unknown): boolean {
  if (Array.isArray(type)) return type.some((candidate) => typeMatches(value, candidate));
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object')
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function schemaIncludesType(schema: Record<string, unknown>, type: string): boolean {
  return schema.type === type || (Array.isArray(schema.type) && schema.type.includes(type));
}

function objectValueProblems(
  value: unknown,
  schema: Record<string, unknown>,
  path: string
): string[] {
  if (!schemaIncludesType(schema, 'object') || !typeMatches(value, 'object')) return [];
  const problems: string[] = [];
  const record = value as Record<string, unknown>;
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const required of (schema.required ?? []) as string[]) {
    if (!(required in record)) problems.push(`${path}.${required}: campo obligatorio ausente.`);
  }
  if (schema.additionalProperties === false) {
    problems.push(
      ...Object.keys(record)
        .filter((key) => !(key in properties))
        .map((key) => `${path}.${key}: campo no permitido.`)
    );
  }
  for (const [key, childSchema] of Object.entries(properties)) {
    if (key in record)
      problems.push(...structuredValueProblems(record[key], childSchema, `${path}.${key}`));
  }
  return problems;
}

function arrayValueProblems(
  value: unknown,
  schema: Record<string, unknown>,
  path: string
): string[] {
  if (!schemaIncludesType(schema, 'array') || !Array.isArray(value)) return [];
  if (!schema.items || typeof schema.items !== 'object') return [];
  return value.flatMap((item, index) =>
    structuredValueProblems(item, schema.items as Record<string, unknown>, `${path}[${index}]`)
  );
}

/** Validador defensivo del subset usado por los contratos del Builder. */
export function structuredValueProblems(
  value: unknown,
  schema: Record<string, unknown>,
  path = '$'
): string[] {
  const problems: string[] = [];
  const expected = schema.type;
  if ((typeof expected === 'string' || Array.isArray(expected)) && !typeMatches(value, expected)) {
    return [`${path}: se esperaba ${Array.isArray(expected) ? expected.join(' | ') : expected}.`];
  }
  if ('const' in schema && !Object.is(schema.const, value))
    problems.push(`${path}: no coincide con const.`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    problems.push(`${path}: valor fuera del enum.`);
  }
  problems.push(...objectValueProblems(value, schema, path));
  problems.push(...arrayValueProblems(value, schema, path));
  return problems;
}

function parseAndValidate(
  content: string,
  schema: Record<string, unknown>,
  finishReason?: string
): unknown {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (error) {
    if (finishReason === 'length') {
      const truncated = new Error(
        'el modelo truncó la respuesta al alcanzar maxTokens.'
      ) as Error & {
        code?: string;
      };
      truncated.code = 'MODEL_OUTPUT_TRUNCATED';
      throw truncated;
    }
    throw new Error(`el modelo no devolvió JSON válido: ${(error as Error).message}`);
  }
  const problems = structuredValueProblems(data, schema);
  if (problems.length)
    throw new Error(`la respuesta no cumple el schema: ${problems.slice(0, 8).join(' ')}`);
  return data;
}

function usageOf(results: ChatCompletionResult[]) {
  const promptTokens = results.reduce((sum, result) => sum + (result.usage?.promptTokens ?? 0), 0);
  const completionTokens = results.reduce(
    (sum, result) => sum + (result.usage?.completionTokens ?? 0),
    0
  );
  const reasoningTokens = results.reduce(
    (sum, result) => sum + (result.usage?.reasoningTokens ?? 0),
    0
  );
  return promptTokens || completionTokens || reasoningTokens
    ? { promptTokens, completionTokens, reasoningTokens }
    : undefined;
}

function isInfrastructureFailure(error: Error & { code?: string; statusCode?: number }): boolean {
  return (
    error.name === 'TypeError' ||
    (error.code === 'OPENROUTER_GATEWAY_ERROR' && (error.statusCode ?? 0) >= 500)
  );
}

export async function structuredServiceStatus() {
  const gateway = await openRouterStructuredStatus();
  return {
    configured: gateway.configured,
    models: gateway.models,
    circuit: Date.now() < openUntil ? 'open' : 'closed',
    retryLimit: 1,
  };
}

export async function completeStructured(
  request: StructuredCompletionRequest,
  deps: Dependencies = defaults
): Promise<StructuredCompletionResponse> {
  validateRequest(request);
  if (deps.now() < openUntil) {
    const error = new Error(
      'servicio IA temporalmente pausado después de errores consecutivos.'
    ) as Error & {
      statusCode?: number;
    };
    error.statusCode = 503;
    throw error;
  }
  const level: IntelligenceLevel =
    request.level === 'fast' || request.level === 'advanced' ? request.level : 'standard';
  const results: ChatCompletionResult[] = [];
  let lastError: Error | null = null;
  let messages = request.messages;
  let maxTokens = request.maxTokens ?? 1200;
  let infrastructureFailure = false;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await deps.call({
        messages,
        level,
        temperature: request.temperature ?? 0,
        maxTokens,
        reasoning:
          request.reasoningEnabled === false
            ? { enabled: false, exclude: true }
            : { effort: request.reasoningEffort ?? 'none', exclude: true },
        responseSchema: request.responseSchema,
      });
      results.push(result);
      // El gateway respondió: una salida inválida no es una caída de infraestructura.
      failures = 0;
      openUntil = 0;
      const data = parseAndValidate(
        result.content,
        request.responseSchema.schema,
        result.finishReason
      );
      return {
        data,
        meta: {
          level,
          model: result.model,
          promptId: request.promptId,
          promptVersion: request.promptVersion,
          attempts: attempt,
          usage: usageOf(results),
        },
      };
    } catch (error) {
      lastError = error as Error;
      infrastructureFailure ||= isInfrastructureFailure(
        error as Error & { code?: string; statusCode?: number }
      );
      if (attempt !== 1) continue;
      if ((error as Error & { code?: string }).code === 'MODEL_OUTPUT_TRUNCATED') {
        maxTokens = Math.min(Math.max(maxTokens * 2, 1000), 4000);
      }
      messages = [
        ...request.messages,
        {
          role: 'user',
          content:
            'La respuesta anterior no pudo validarse. Respondé nuevamente y devolvé únicamente un objeto JSON que cumpla exactamente el schema indicado.',
        },
      ];
    }
  }

  if (infrastructureFailure) {
    failures += 1;
    if (failures >= FAILURE_LIMIT) openUntil = deps.now() + COOLDOWN_MS;
  }
  const exhausted = new Error(
    `no se obtuvo una respuesta estructurada válida después de 2 intentos: ${lastError?.message}`
  ) as Error & { code?: string; statusCode?: number };
  exhausted.code = 'STRUCTURED_OUTPUT_INVALID';
  exhausted.statusCode = infrastructureFailure ? 503 : 422;
  throw exhausted;
}

/** Solo para aislar tests; no forma parte del endpoint. */
export function resetStructuredCircuitForTests(): void {
  failures = 0;
  openUntil = 0;
}
