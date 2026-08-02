/**
 * Traducción del catálogo de capacidades (COONG-288) a tools de MCP.
 *
 * El catálogo es el único lugar donde se declara qué puede hacer un agente:
 * acá solo se lo renombra y se lo filtra. Nada de lógica de negocio.
 */

import type { TenantCapability } from '../endpoints/_context.js';

import type { ConnectionProfile } from './connections.js';

/** Efectos que publica cada perfil. */
const PROFILE_EFFECTS: Record<ConnectionProfile, ReadonlyArray<TenantCapability['effect']>> = {
  readonly: ['read'],
  operator: ['read', 'write'],
  admin: ['read', 'write', 'destructive'],
};

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
  };
}

/**
 * Los ids de capacidad usan puntos (`leases.contracts.list`) y los clientes de
 * MCP exigen `[a-zA-Z0-9_-]{1,64}`. El guion bajo es reversible porque ningún
 * id de capacidad lo usa como separador.
 */
export function toToolName(capabilityId: string): string {
  return capabilityId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

export function capabilitiesFor(
  capabilities: TenantCapability[],
  profile: ConnectionProfile
): TenantCapability[] {
  const allowed = PROFILE_EFFECTS[profile];
  return capabilities.filter((capability) => allowed.includes(capability.effect));
}

export function toTool(capability: TenantCapability): McpTool {
  return {
    name: toToolName(capability.id),
    title: capability.title,
    description: describe(capability),
    inputSchema: publicInputSchema(capability.inputSchema),
    annotations: {
      title: capability.title,
      readOnlyHint: capability.effect === 'read',
      destructiveHint: capability.effect === 'destructive',
    },
  };
}

/**
 * Los `const` son administrados por la plataforma: no son una decisión del
 * cliente ni deben ocupar contexto. Se eliminan del schema público, pero el
 * protocolo conserva el schema original y los inyecta antes de ejecutar.
 */
function publicInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const visit = (node: Record<string, unknown>): Record<string, unknown> | null => {
    if (node.const !== undefined) return null;
    const result = { ...node };
    const properties = node.properties as Record<string, Record<string, unknown>> | undefined;
    if (properties) {
      const visible = Object.entries(properties)
        .map(([key, property]) => [key, visit(property)] as const)
        .filter((entry): entry is readonly [string, Record<string, unknown>] => entry[1] !== null);
      result.properties = Object.fromEntries(visible);
      if (Array.isArray(node.required)) {
        result.required = node.required.filter((key) => key in (result.properties as object));
      }
    }
    if (node.items && typeof node.items === 'object') {
      result.items = visit(node.items as Record<string, unknown>) ?? {};
    }
    return result;
  };
  return visit(schema) ?? { type: 'object', properties: {}, additionalProperties: false };
}

/**
 * Al agente le sirve saber que una acción modifica datos incluso si su cliente
 * ignora las annotations — de ahí el aviso en la propia descripción.
 */
function describe(capability: TenantCapability): string {
  if (capability.effect === 'read') return capability.description;
  const warning =
    capability.effect === 'destructive'
      ? 'ATENCIÓN: elimina datos de forma permanente. Confirmá con la persona antes de usarla.'
      : 'Modifica datos reales del negocio. Confirmá con la persona antes de usarla.';
  return `${capability.description}\n\n${warning}`;
}

/** Índice nombre-de-tool → capacidad, para resolver `tools/call`. */
export function indexByToolName(capabilities: TenantCapability[]): Map<string, TenantCapability> {
  return new Map(capabilities.map((capability) => [toToolName(capability.id), capability]));
}
