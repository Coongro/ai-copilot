/**
 * Salvaguardas de ejecución: cuánto puede llamar una conexión y qué pasa si
 * repite exactamente la misma escritura.
 *
 * Un agente que entra en loop —o un cliente que reintenta porque se le cortó la
 * respuesta— puede ejecutar la misma acción muchas veces. El límite frena el
 * loop; la idempotencia evita que el reintento duplique datos.
 *
 * El estado es **por proceso** y en memoria: alcanza para el modelo de deploy
 * actual (una instancia de API). Con varias instancias los límites se aplicarían
 * por instancia, no globalmente — cuando eso pase, va a Redis.
 */

import { createHash } from 'node:crypto';

/** Llamadas por minuto y por conexión. */
const DEFAULT_RATE_LIMIT = 60;
/** Escrituras por minuto y por conexión — más acotado que las lecturas. */
const DEFAULT_WRITE_RATE_LIMIT = 20;
const WINDOW_MS = 60_000;

/** Ventana en la que un reintento idéntico se considera el mismo pedido. */
const IDEMPOTENCY_TTL_MS = 60_000;

function envLimit(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Timestamps de las llamadas dentro de la ventana, por conexión. */
const calls = new Map<string, number[]>();
const writes = new Map<string, number[]>();

function hit(bucket: Map<string, number[]>, key: string, limit: number, now: number): boolean {
  const recent = (bucket.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= limit) {
    bucket.set(key, recent);
    return false;
  }
  recent.push(now);
  bucket.set(key, recent);
  return true;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Mensaje para el agente cuando se pasó del límite. */
  message?: string;
}

/**
 * Consume una llamada del presupuesto de la conexión. Las escrituras consumen
 * de los dos contadores: una ráfaga de escrituras también es una ráfaga.
 */
export function checkRateLimit(connectionId: string, isWrite: boolean): RateLimitVerdict {
  const now = Date.now();

  if (!hit(calls, connectionId, envLimit('AI_COPILOT_MCP_RATE_LIMIT', DEFAULT_RATE_LIMIT), now)) {
    return {
      allowed: false,
      message:
        'Se alcanzó el límite de llamadas por minuto de esta conexión. Esperá un momento antes de seguir.',
    };
  }

  if (
    isWrite &&
    !hit(
      writes,
      connectionId,
      envLimit('AI_COPILOT_MCP_WRITE_RATE_LIMIT', DEFAULT_WRITE_RATE_LIMIT),
      now
    )
  ) {
    return {
      allowed: false,
      message:
        'Se alcanzó el límite de operaciones de escritura por minuto de esta conexión. Revisá con la persona qué hace falta antes de seguir.',
    };
  }

  return { allowed: true };
}

interface IdempotencyEntry {
  at: number;
  result: unknown;
}

const executed = new Map<string, IdempotencyEntry>();

/**
 * Identidad de una escritura: misma conexión, misma capacidad y mismos
 * argumentos. Las claves del objeto se ordenan para que el orden en que el
 * modelo las serializó no cambie el hash.
 */
export function idempotencyKey(
  connectionId: string,
  capabilityId: string,
  args: Record<string, unknown>
): string {
  const canonical = JSON.stringify(args, Object.keys(args).sort());
  return createHash('sha256').update(`${connectionId}:${capabilityId}:${canonical}`).digest('hex');
}

/** Resultado de una escritura idéntica reciente, si la hubo. */
export function recallExecution(key: string): { result: unknown } | null {
  const entry = executed.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > IDEMPOTENCY_TTL_MS) {
    executed.delete(key);
    return null;
  }
  return { result: entry.result };
}

export function rememberExecution(key: string, result: unknown): void {
  executed.set(key, { at: Date.now(), result });
  pruneExecuted();
}

/**
 * Limpieza perezosa: sin esto el Map crece con cada escritura del día. Corre
 * sobre el escritor, que ya es la ruta lenta.
 */
function pruneExecuted(): void {
  const now = Date.now();
  for (const [key, entry] of executed) {
    if (now - entry.at > IDEMPOTENCY_TTL_MS) executed.delete(key);
  }
}

/** Solo para tests: reinicia contadores y memoria de ejecuciones. */
export function resetLimits(): void {
  calls.clear();
  writes.clear();
  executed.clear();
}
