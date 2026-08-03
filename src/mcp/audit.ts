/**
 * Auditoría del runtime MCP (COONG-291).
 *
 * Cada invocación de tool deja rastro: conexión, tenant, capability, efecto,
 * resultado y duración. Buffer en memoria (consultable por el inspector) más
 * una línea JSON en stdout que los drains de observabilidad ya saben levantar.
 * Persistir en log_entries queda para cuando el kit de observabilidad exponga
 * su API de escritura a plugins (hoy es interno).
 */

export interface AuditEntry {
  at: string;
  connectionId: string;
  tenantId: string;
  capabilityId: string;
  action: string;
  effect: string;
  outcome: 'ok' | 'error' | 'rejected' | 'confirmation_required';
  detail?: string;
  durationMs?: number;
}

const MAX_ENTRIES = 500;
const entries: AuditEntry[] = [];

export function recordAudit(entry: Omit<AuditEntry, 'at'>): void {
  const full: AuditEntry = { at: new Date().toISOString(), ...entry };
  entries.push(full);
  if (entries.length > MAX_ENTRIES) entries.shift();
  // eslint-disable-next-line no-console -- línea estructurada para drains de logs
  console.info(`[copilot-audit] ${JSON.stringify(full)}`);
}

export function listAudit(limit = 50): AuditEntry[] {
  return entries.slice(-limit).reverse();
}

/** Solo para tests. */
export function resetAudit(): void {
  entries.length = 0;
}
