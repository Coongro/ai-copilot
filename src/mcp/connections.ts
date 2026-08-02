/**
 * Conexiones de agentes: emisión, autenticación y ciclo de vida del token.
 *
 * El token tiene el tenant adentro (`cnx_<tenantHex>_<secreto>`) porque el
 * endpoint MCP es público: no hay JWT ni header de tenant del que deducirlo, y
 * sin tenant no hay base de datos contra la cual buscar la conexión. El tenant
 * del token es solo un puntero — lo que autentica es el secreto, que se guarda
 * hasheado y se compara en tiempo constante.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { PlatformAPI, TenantDatabase } from '../endpoints/_context.js';
import { agentConnectionTable, type AgentConnectionRow } from '../schema/agent-connection.js';

/** Perfil de permisos de la conexión: acota qué capacidades se publican. */
export type ConnectionProfile = 'readonly' | 'operator' | 'admin';

export const CONNECTION_PROFILES: ConnectionProfile[] = ['readonly', 'operator', 'admin'];

export function isConnectionProfile(value: unknown): value is ConnectionProfile {
  return typeof value === 'string' && CONNECTION_PROFILES.includes(value as ConnectionProfile);
}

/**
 * Etiquetas que muestran los formularios → perfil guardado. El selector del
 * Builder manda el texto que ve la persona, no el valor técnico, así que la
 * traducción vive acá: en la puerta de entrada, no repetida en cada vista.
 */
const PROFILE_BY_LABEL: Record<string, ConnectionProfile> = {
  'Solo consulta': 'readonly',
  'Consulta y opera': 'operator',
  'Sin restricción': 'admin',
};

/** Perfil desde un valor crudo o desde su etiqueta; `null` si no es ninguno. */
export function toConnectionProfile(value: unknown): ConnectionProfile | null {
  if (isConnectionProfile(value)) return value;
  if (typeof value !== 'string') return null;
  return PROFILE_BY_LABEL[value.trim()] ?? null;
}

/** Conexión tal como se expone a la UI — nunca incluye el secreto. */
export interface ConnectionSummary {
  id: string;
  name: string;
  channel: string;
  profile: ConnectionProfile;
  /** Kit al que está atada; `null` = todo el espacio. */
  kitId: string | null;
  enabled: boolean;
  tokenHint: string;
  capabilityRevision: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  /** Ya venció: sigue listada, pero no autentica. */
  expired: boolean;
}

export interface AuthenticatedConnection {
  tenantId: string;
  connection: AgentConnectionRow;
  database: TenantDatabase;
}

const TOKEN_PREFIX = 'cnx_';

/** Vigencia por defecto de un token nuevo. */
export const DEFAULT_EXPIRY_DAYS = 90;
/** Techo: más allá de esto el token deja de ser una credencial acotada. */
export const MAX_EXPIRY_DAYS = 365;

/** Columnas que se escriben al crear una conexión. */
interface AgentConnectionInsert {
  name: string;
  channel: string;
  profile: ConnectionProfile;
  kit_id: string | null;
  token_hash: string;
  token_hint: string;
  expires_at: string;
}

/** Columnas que se actualizan después de creada. */
interface AgentConnectionPatch {
  enabled?: boolean;
  capability_revision?: string;
  last_used_at?: string;
  updated_at?: string;
}

/**
 * drizzle 0.38.x deja fuera del tipo de `insert`/`update` toda columna con
 * `.default()`: solo admite las `notNull` sin default. El cast repone la forma
 * real de la tabla en un único lugar — el tipado efectivo lo dan
 * `AgentConnectionInsert` y `AgentConnectionPatch`.
 */
function writable(values: AgentConnectionInsert | AgentConnectionPatch): never {
  return values as never;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparación en tiempo constante de dos hashes hex del mismo largo. */
function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** UUID del tenant → 32 hex, para que el token sea una sola palabra sin guiones. */
function packTenantId(tenantId: string): string {
  return tenantId.replace(/-/g, '').toLowerCase();
}

function unpackTenantId(packed: string): string | null {
  if (!/^[0-9a-f]{32}$/.test(packed)) return null;
  return [
    packed.slice(0, 8),
    packed.slice(8, 12),
    packed.slice(12, 16),
    packed.slice(16, 20),
    packed.slice(20),
  ].join('-');
}

export function toSummary(row: AgentConnectionRow): ConnectionSummary {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    profile: isConnectionProfile(row.profile) ? row.profile : 'readonly',
    kitId: row.kit_id,
    enabled: row.enabled,
    tokenHint: row.token_hint,
    capabilityRevision: row.capability_revision,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    expired: hasExpired(row.expires_at),
  };
}

/** Una conexión sin vencimiento (las previas a la columna) nunca expira. */
function hasExpired(expiresAt: string | null): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();
}

export async function listConnections(database: TenantDatabase): Promise<ConnectionSummary[]> {
  const rows = await database.ormQuery((db) => db.select().from(agentConnectionTable));
  return (rows as AgentConnectionRow[])
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(toSummary);
}

export interface CreatedConnection {
  connection: ConnectionSummary;
  /** Token en claro. Se devuelve UNA sola vez: después solo queda el hash. */
  token: string;
}

export async function createConnection(
  database: TenantDatabase,
  input: { name: string; profile: ConnectionProfile; kitId?: string | null; expiresInDays?: number }
): Promise<CreatedConnection> {
  const secret = randomBytes(24).toString('hex');
  const token = `${TOKEN_PREFIX}${packTenantId(database.tenantId)}_${secret}`;
  const days = clampExpiryDays(input.expiresInDays);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const rows = await database.ormQuery((db) =>
    db
      .insert(agentConnectionTable)
      .values(
        writable({
          name: input.name,
          channel: 'mcp',
          profile: input.profile,
          kit_id: input.kitId ?? null,
          token_hash: hashToken(token),
          token_hint: secret.slice(-6),
          expires_at: expiresAt,
        })
      )
      .returning()
  );

  return { connection: toSummary(rows[0]), token };
}

/** Días de vigencia pedidos, acotados al rango permitido. */
function clampExpiryDays(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_EXPIRY_DAYS;
  }
  return Math.min(Math.floor(requested), MAX_EXPIRY_DAYS);
}

/** Habilita o deshabilita una conexión. Revocar corta el acceso al instante. */
export async function setConnectionEnabled(
  database: TenantDatabase,
  id: string,
  enabled: boolean
): Promise<ConnectionSummary | null> {
  const rows = await database.ormQuery((db) =>
    db
      .update(agentConnectionTable)
      .set(writable({ enabled, updated_at: new Date().toISOString() }))
      .where(eq(agentConnectionTable.id, id))
      .returning()
  );
  const row = rows[0];
  return row ? toSummary(row) : null;
}

export async function deleteConnection(database: TenantDatabase, id: string): Promise<boolean> {
  const rows = await database.ormQuery((db) =>
    db.delete(agentConnectionTable).where(eq(agentConnectionTable.id, id)).returning()
  );
  return rows.length > 0;
}

/**
 * Resuelve un token a su conexión. Devuelve `null` ante cualquier fallo —
 * formato inválido, tenant inexistente, conexión revocada o secreto que no
 * coincide — sin distinguir el motivo hacia afuera.
 */
export async function authenticate(
  platform: PlatformAPI,
  token: string | undefined
): Promise<AuthenticatedConnection | null> {
  if (!token?.startsWith(TOKEN_PREFIX)) return null;

  const [packedTenant] = token.slice(TOKEN_PREFIX.length).split('_');
  const tenantId = unpackTenantId(packedTenant ?? '');
  if (!tenantId) return null;

  const database = platform.databaseFor(tenantId);
  const expected = hashToken(token);

  let rows: AgentConnectionRow[];
  try {
    rows = (await database.ormQuery((db) =>
      db
        .select()
        .from(agentConnectionTable)
        .where(
          and(eq(agentConnectionTable.token_hash, expected), eq(agentConnectionTable.enabled, true))
        )
    )) as AgentConnectionRow[];
  } catch {
    // Tenant inexistente o schema sin migrar: es un token que no sirve.
    return null;
  }

  const connection = rows.find((row) => hashesMatch(row.token_hash, expected));
  if (!connection || hasExpired(connection.expires_at)) return null;

  return { tenantId, connection, database };
}

/**
 * Registra el uso y la revisión del catálogo que el cliente acaba de ver. El
 * fallo es silencioso a propósito: es telemetría, no puede tumbar una llamada
 * del agente.
 */
export async function touchConnection(
  database: TenantDatabase,
  id: string,
  capabilityRevision?: string
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await database.ormQuery((db) =>
      db
        .update(agentConnectionTable)
        .set(
          writable({
            last_used_at: now,
            updated_at: now,
            ...(capabilityRevision ? { capability_revision: capabilityRevision } : {}),
          })
        )
        .where(eq(agentConnectionTable.id, id))
    );
  } catch {
    // Best-effort.
  }
}
