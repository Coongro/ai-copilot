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
 */

import { createHash, randomBytes } from 'node:crypto';

const TTL_MS = 10 * 60 * 1000;
const pending = new Map<string, { key: string; expiresAt: number }>();

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
  if (pending.size > 500) {
    const now = Date.now();
    for (const [t, entry] of pending) {
      if (entry.expiresAt < now) pending.delete(t);
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
): boolean {
  if (typeof token !== 'string') return false;
  const entry = pending.get(token);
  if (!entry) return false;
  pending.delete(token);
  if (entry.expiresAt < Date.now()) return false;
  return entry.key === confirmationKey(connectionId, capabilityId, args);
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
}
