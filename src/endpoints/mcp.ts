/**
 * POST /mcp  (auth: 'none')
 *
 * Endpoint MCP del tenant: acá se conectan Claude, ChatGPT, Codex o cualquier
 * cliente compatible. Es público a nivel de plataforma porque estos clientes no
 * pueden mandar el JWT de Coongro ni headers propios; la autenticación es el
 * token de conexión, que viaja en `Authorization: Bearer` o, cuando el cliente
 * solo permite pegar una URL, en el query param `k`.
 *
 * URL final: POST /api/plugins/ai-copilot/mcp?k=cnx_...
 */

import { handleMcpMessage, type JsonRpcResponse } from '../mcp/protocol.js';

import type { JwtContext } from './_context.js';

/** El token viaja donde el cliente pueda ponerlo: header si puede, URL si no. */
function extractToken(ctx: JwtContext): string | undefined {
  const header = ctx.headers.authorization ?? ctx.headers.Authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return ctx.query.k?.trim() || undefined;
}

export async function mcp(ctx: JwtContext): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  return handleMcpMessage(ctx.body, extractToken(ctx), ctx.platform);
}
