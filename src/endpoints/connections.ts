/**
 * GET /connections/context  (auth: 'jwt')
 *
 * Lo que la vista de conexiones necesita y NO sale de la base del plugin: los
 * kits del espacio y el tamaño del catálogo por perfil. Vive como endpoint
 * porque son primitivas de plataforma (`ctx.platform`), a las que un
 * repositorio —que solo recibe la base— no llega.
 *
 * El ABM de conexiones NO pasa por acá: es el repositorio `ai-copilot.connections`.
 *
 * URL final: /api/plugins/ai-copilot/connections/context
 */

import type { ConnectionProfile } from '../mcp/connections.js';
import { capabilitiesFor } from '../mcp/tools.js';

import type { JwtContext } from './_context.js';

/**
 * Base pública de la API. En dev la API vive en localhost y hay que exponerla
 * por un túnel para que Claude/ChatGPT lleguen: esa URL va acá.
 */
function publicApiUrl(): string {
  return (
    process.env.COONGRO_PUBLIC_API_URL?.trim() ||
    process.env.API_PUBLIC_URL?.trim() ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
}

export interface ConnectionsContext {
  /** URL del endpoint MCP sin token; la conexión le agrega su `?k=`. */
  endpointUrl: string;
  /** Kits del espacio: a cuál se puede atar una conexión. */
  kits: Array<{ pluginId: string; displayName: string }>;
  capabilities: {
    revision: string;
    total: number;
    byProfile: Record<ConnectionProfile, number>;
  };
}

export async function context(ctx: JwtContext): Promise<ConnectionsContext> {
  const tenantId = ctx.user?.tenantId;
  if (!tenantId) throw new Error('Endpoint requiere autenticación.');

  const [catalog, kits] = await Promise.all([
    ctx.platform.listCopilotCapabilities(tenantId),
    ctx.platform.listKits(tenantId),
  ]);

  return {
    endpointUrl: `${publicApiUrl()}/api/plugins/ai-copilot/mcp`,
    kits,
    capabilities: {
      revision: catalog.revision,
      total: catalog.capabilities.length,
      byProfile: {
        readonly: capabilitiesFor(catalog.capabilities, 'readonly').length,
        operator: capabilitiesFor(catalog.capabilities, 'operator').length,
        admin: capabilitiesFor(catalog.capabilities, 'admin').length,
      },
    },
  };
}

/** URL completa que se pega en el cliente MCP, con el token de la conexión. */
export function mcpUrlFor(token: string): string {
  return `${publicApiUrl()}/api/plugins/ai-copilot/mcp?k=${token}`;
}
