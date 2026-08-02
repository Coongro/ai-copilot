/**
 * Política por conexión (COONG-291).
 *
 * La publicación del plugin define QUÉ capabilities existen; esta política
 * decide cuáles puede usar cada conexión concreta. El mismo catálogo
 * compilado sirve para todos los canales — cada canal aporta identidad,
 * sesión y formato, nunca otra implementación.
 *
 * La fila de conexión puede traer una columna `policy` (JSON). Sin ella, la
 * política se deriva del perfil histórico (readonly/operator/admin) y la
 * confirmación queda en manos del contrato de cada capability.
 */

import type { TenantCapability } from '../endpoints/_context.js';

import { isConnectionProfile, type ConnectionProfile } from './connections.js';
import { capabilitiesFor } from './tools.js';

export type AgentChannel = 'mcp' | 'whatsapp' | 'telegram' | 'web';

export interface AgentConnectionPolicy {
  channel: AgentChannel;
  mode: ConnectionProfile;
  allowedCapabilities: string[] | null;
  deniedCapabilities: string[];
  /**
   * `contract` respeta la confirmación declarada por cada capability;
   * `writes` fuerza confirmación para toda escritura aunque el contrato diga
   * menos; `always` confirma hasta las lecturas (canales de altísimo riesgo).
   */
  confirmationPolicy: 'always' | 'writes' | 'contract';
}

interface ConnectionRowLike {
  channel?: string | null;
  profile?: string | null;
  policy?: string | Record<string, unknown> | null;
}

const CHANNELS: AgentChannel[] = ['mcp', 'whatsapp', 'telegram', 'web'];

export function policyFor(row: ConnectionRowLike): AgentConnectionPolicy {
  const raw = typeof row.policy === 'string' ? safeParse(row.policy) : (row.policy ?? null);
  const channel = CHANNELS.includes(row.channel as AgentChannel)
    ? (row.channel as AgentChannel)
    : 'mcp';
  const mode = isConnectionProfile(row.profile ?? '')
    ? (row.profile as ConnectionProfile)
    : 'readonly';
  return {
    channel,
    mode,
    allowedCapabilities: Array.isArray(raw?.allowedCapabilities)
      ? (raw.allowedCapabilities as string[])
      : null,
    deniedCapabilities: Array.isArray(raw?.deniedCapabilities)
      ? (raw.deniedCapabilities as string[])
      : [],
    confirmationPolicy: ['always', 'writes', 'contract'].includes(String(raw?.confirmationPolicy))
      ? (raw.confirmationPolicy as AgentConnectionPolicy['confirmationPolicy'])
      : 'contract',
  };
}

function safeParse(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Filtro completo: perfil (efectos) + lista blanca + lista negra. */
export function applyPolicy(
  capabilities: TenantCapability[],
  policy: AgentConnectionPolicy
): TenantCapability[] {
  const byProfile = capabilitiesFor(capabilities, policy.mode);
  return byProfile.filter(
    (capability) =>
      !policy.deniedCapabilities.includes(capability.id) &&
      (!policy.allowedCapabilities || policy.allowedCapabilities.includes(capability.id))
  );
}

/** ¿Esta llamada exige el flujo de confirmación con token? */
export function confirmationRequired(
  capability: TenantCapability,
  policy: AgentConnectionPolicy
): boolean {
  if (policy.confirmationPolicy === 'always') return true;
  if (capability.effect === 'read') return false;
  if (policy.confirmationPolicy === 'writes') return true;
  return capability.confirmation === 'always';
}
