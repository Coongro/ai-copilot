/**
 * Confirmación server-side de escrituras (COONG-291).
 *
 * Hasta ahora la confirmación era una instrucción en el prompt ("confirmá con
 * la persona"): un modelo obediente la respeta, uno apurado no. Con esto la
 * PRIMERA llamada a una escritura que declara `confirmation: always` no
 * ejecuta nada: devuelve `confirmation_required` con un resumen y un token.
 * La ejecución real solo ocurre en la segunda llamada, con el token vigente.
 *
 * Los tokens son de un solo uso, atados a la conexión, la capability y el
 * HASH de los argumentos: cambiar un monto después de confirmar invalida la
 * confirmación. Estado en memoria, igual que los rate limits — un reinicio
 * del proceso solo obliga a reconfirmar, nunca ejecuta de más.
 *
 * COONG-300: el token es además la IDENTIDAD DEL PEDIDO. Un token redimido no
 * se olvida: guarda el resultado de su ejecución, así un reintento de
 * transporte con el mismo token devuelve lo que ya pasó en vez de ejecutarlo
 * otra vez. Esa es la única idempotencia correcta para un alta — deduplicar por
 * el hash de los datos fusiona dos altas legítimamente iguales (dos «Cochera»,
 * dos homónimos) y hace desaparecer una en silencio.
 */

import { createHash, randomBytes } from 'node:crypto';

const TTL_MS = 10 * 60 * 1000;
/** Cuánto sigue sirviendo un token ya redimido para responder el mismo pedido. */
const RESULT_TTL_MS = 60_000;

interface PendingEntry {
  key: string;
  expiresAt: number;
}

interface ConsumedEntry extends PendingEntry {
  /** Cuándo se redimió (o se completó): base de `RESULT_TTL_MS`. */
  at: number;
  done: boolean;
  result?: unknown;
}

const pending = new Map<string, PendingEntry>();
const consumed = new Map<string, ConsumedEntry>();

/**
 * Qué hacer con una llamada que trae token:
 *
 *  - `required`  no hay confirmación válida: pedirla (emitir token nuevo).
 *  - `granted`   primera redención: ejecutar.
 *  - `replayed`  mismo pedido ya ejecutado: devolver aquel resultado.
 *  - `inFlight`  mismo pedido todavía ejecutándose: no ejecutar de nuevo.
 */
export type ConfirmationVerdict =
  | { status: 'required' }
  | { status: 'granted' }
  | { status: 'replayed'; result: unknown }
  | { status: 'inFlight' };

function argsHash(args: Record<string, unknown>): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])])
    );
  };
  return createHash('sha256')
    .update(JSON.stringify(stable(args)))
    .digest('hex');
}

function confirmationKey(
  connectionId: string,
  capabilityId: string,
  args: Record<string, unknown>
) {
  return `${connectionId}|${capabilityId}|${argsHash(args)}`;
}

/** Emite un token para exactamente esta operación con estos argumentos. */
export function issueConfirmation(
  connectionId: string,
  capabilityId: string,
  args: Record<string, unknown>
): string {
  const token = randomBytes(24).toString('base64url');
  pending.set(token, {
    key: confirmationKey(connectionId, capabilityId, args),
    expiresAt: Date.now() + TTL_MS,
  });
  // Poda perezosa: sin timers, igual que limits.ts.
  if (pending.size + consumed.size > 500) {
    const now = Date.now();
    for (const [t, entry] of pending) {
      if (entry.expiresAt < now) pending.delete(t);
    }
    for (const [t, entry] of consumed) {
      if (now - entry.at > RESULT_TTL_MS) consumed.delete(t);
    }
  }
  return token;
}

/** Consume el token (un solo uso). Solo vale para la misma operación y args. */
export function redeemConfirmation(
  token: unknown,
  connectionId: string,
  capabilityId: string,
  args: Record<string, unknown>
): ConfirmationVerdict {
  if (typeof token !== 'string') return { status: 'required' };
  const key = confirmationKey(connectionId, capabilityId, args);

  // Ya redimido: solo sirve para responder EL MISMO pedido. Si los argumentos
  // no son los de entonces, o si pasó la ventana, se vuelve a confirmar.
  const used = consumed.get(token);
  if (used) {
    if (used.key !== key || Date.now() - used.at > RESULT_TTL_MS) {
      consumed.delete(token);
      return { status: 'required' };
    }
    return used.done ? { status: 'replayed', result: used.result } : { status: 'inFlight' };
  }

  const entry = pending.get(token);
  if (!entry) return { status: 'required' };
  // El intento quema el token aunque no proceda: una confirmación que se usó
  // para otros argumentos no puede quedar disponible para los originales.
  pending.delete(token);
  if (entry.expiresAt < Date.now() || entry.key !== key) return { status: 'required' };

  consumed.set(token, { ...entry, at: Date.now(), done: false });
  return { status: 'granted' };
}

/** La ejecución terminó bien: el token pasa a responder por su resultado. */
export function completeConfirmation(token: string, result: unknown): void {
  const entry = consumed.get(token);
  if (!entry) return;
  entry.done = true;
  entry.result = result;
  entry.at = Date.now();
}

/**
 * La ejecución no llegó a completarse (falló o cortó). El token vuelve a estar
 * pendiente: el mismo pedido se puede reintentar sin pedir otra confirmación, y
 * sobre todo no queda trabado en `inFlight` hasta que expire.
 */
export function releaseConfirmation(token: string): void {
  const entry = consumed.get(token);
  if (!entry) return;
  consumed.delete(token);
  if (entry.expiresAt > Date.now())
    pending.set(token, { key: entry.key, expiresAt: entry.expiresAt });
}

/** Resumen legible de lo que se está por hacer, para que la persona decida. */
export function confirmationSummary(title: string, args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null)
    .slice(0, 8)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
    );
  if (!parts.length) return title;
  return `${title} — ${parts.join(' · ')}`;
}

/** Solo para tests. */
export function resetConfirmations(): void {
  pending.clear();
  consumed.clear();
}
