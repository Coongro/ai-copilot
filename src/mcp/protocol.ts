/**
 * Servidor MCP (Model Context Protocol) sobre JSON-RPC 2.0.
 *
 * Transporte: Streamable HTTP en su forma más simple — un POST con un mensaje
 * JSON-RPC y una respuesta JSON. No abrimos SSE porque no hay nada que el
 * servidor tenga para empujar: sin streaming, el catálogo de tools se refresca
 * cuando el cliente vuelve a pedir `tools/list`.
 *
 * Implementa el mínimo que Claude y ChatGPT ejercitan al conectar un servidor
 * remoto: `initialize`, `tools/list` y `tools/call` (más `ping`). Los métodos
 * de prompts y resources se responden como no implementados, que es lo correcto
 * cuando no se declara esa capability.
 */

import type { PlatformAPI, TenantCapability } from '../endpoints/_context.js';

import {
  authenticate,
  touchConnection,
  isConnectionProfile,
  type AuthenticatedConnection,
} from './connections.js';
import { checkRateLimit, idempotencyKey, recallExecution, rememberExecution } from './limits.js';
import { renderResult } from './render.js';
import { capabilitiesFor, indexByToolName, toTool } from './tools.js';
import { applySchemaValues, validateArgs } from './validate.js';

/** Última versión del protocolo que este servidor implementa. */
const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const SERVER_INSTRUCTIONS = [
  'Este servidor expone las capacidades del negocio del tenant en Coongro.',
  'Cada herramienta corresponde a una acción real del sistema: los datos que devuelve son de producción del cliente, no de ejemplo.',
  'Antes de crear, modificar o eliminar algo, confirmá explícitamente con la persona.',
  'Si una herramienta que esperás no está disponible, es porque el perfil de esta conexión no la habilita.',
].join(' ');

export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** Rango reservado para la aplicación: token inválido o conexión revocada. */
  unauthorized: -32001,
} as const;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.jsonrpc === '2.0' && typeof candidate.method === 'string';
}

/**
 * Procesa un mensaje (o un batch) y devuelve la respuesta, o `null` si todo lo
 * recibido eran notificaciones — que por spec no llevan respuesta.
 */
export async function handleMcpMessage(
  message: unknown,
  token: string | undefined,
  platform: PlatformAPI
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(message)) {
    const responses = await Promise.all(
      message.map((item) => handleMcpMessage(item, token, platform))
    );
    const answered = responses.flatMap((r) => (r === null ? [] : [r as JsonRpcResponse]));
    return answered.length > 0 ? answered : null;
  }

  if (!isJsonRpcRequest(message)) {
    return fail(null, JSON_RPC_ERRORS.invalidRequest, 'Mensaje JSON-RPC 2.0 inválido.');
  }

  // Sin `id` es una notificación: se procesa (nada que hacer hoy) y no se responde.
  if (message.id === undefined) return null;
  const id = message.id ?? null;

  if (message.method === 'ping') return ok(id, {});

  const connection = await authenticate(platform, token);
  if (!connection) {
    return fail(
      id,
      JSON_RPC_ERRORS.unauthorized,
      'Token de conexión inválido o revocado. Generá una conexión nueva desde Coongro.'
    );
  }

  switch (message.method) {
    case 'initialize':
      return ok(id, initializeResult(message.params));

    case 'tools/list':
      return ok(id, await listTools(connection, platform));

    case 'tools/call':
      return callTool(id, message.params, connection, platform);

    case 'prompts/list':
    case 'resources/list':
    case 'resources/templates/list':
      return fail(
        id,
        JSON_RPC_ERRORS.methodNotFound,
        `Este servidor solo expone tools (${message.method} no implementado).`
      );

    default:
      return fail(id, JSON_RPC_ERRORS.methodNotFound, `Método no soportado: ${message.method}.`);
  }
}

function initializeResult(params: Record<string, unknown> | undefined): unknown {
  const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : null;
  return {
    // Devolver la versión del cliente cuando la soportamos evita que aborte por
    // mismatch; si pide una que no conocemos, respondemos con la nuestra.
    protocolVersion:
      requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: 'coongro', title: 'Coongro', version: '1.0.0' },
    instructions: SERVER_INSTRUCTIONS,
  };
}

function profileOf(connection: AuthenticatedConnection) {
  return isConnectionProfile(connection.connection.profile)
    ? connection.connection.profile
    : 'readonly';
}

async function resolveCapabilities(
  connection: AuthenticatedConnection,
  platform: PlatformAPI
): Promise<{ capabilities: TenantCapability[]; revision: string }> {
  // El kit de la conexión acota el catálogo antes que el perfil: primero QUÉ
  // parte del negocio, después CON QUÉ permisos.
  const catalog = await platform.listCopilotCapabilities(
    connection.tenantId,
    connection.connection.kit_id
  );
  return {
    capabilities: capabilitiesFor(catalog.capabilities, profileOf(connection)),
    revision: catalog.revision,
  };
}

async function listTools(
  connection: AuthenticatedConnection,
  platform: PlatformAPI
): Promise<unknown> {
  const { capabilities, revision } = await resolveCapabilities(connection, platform);
  await touchConnection(connection.database, connection.connection.id, revision);
  return { tools: capabilities.map(toTool) };
}

async function callTool(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
  connection: AuthenticatedConnection,
  platform: PlatformAPI
): Promise<JsonRpcResponse> {
  const name = typeof params?.name === 'string' ? params.name : null;
  if (!name) return fail(id, JSON_RPC_ERRORS.invalidParams, 'Falta el nombre de la herramienta.');

  const requestedArgs = (params?.arguments ?? {}) as Record<string, unknown>;
  const { capabilities } = await resolveCapabilities(connection, platform);
  const capability = indexByToolName(capabilities).get(name);

  if (!capability) {
    // No distinguimos "no existe" de "tu perfil no la habilita": el agente no
    // debería poder mapear las capacidades que el tenant tiene y él no.
    return fail(
      id,
      JSON_RPC_ERRORS.invalidParams,
      `La herramienta "${name}" no está disponible en esta conexión.`
    );
  }

  const normalizedArgs = applySchemaValues(capability.inputSchema, requestedArgs);
  const invalid = validateArgs(capability.inputSchema, normalizedArgs);
  if (invalid) return toolError(id, invalid);
  const args = effectiveArgs(capability, normalizedArgs);

  const isWrite = capability.effect !== 'read';
  const limit = checkRateLimit(connection.connection.id, isWrite);
  if (!limit.allowed) return toolError(id, limit.message ?? 'Límite de uso alcanzado.');

  // Un reintento idéntico de una escritura devuelve el resultado anterior en
  // lugar de ejecutarla otra vez (ver `limits.ts`).
  const key = isWrite ? idempotencyKey(connection.connection.id, capability.id, args) : null;
  if (key) {
    const previous = recallExecution(key);
    if (previous) return ok(id, previous.result);
  }

  await touchConnection(connection.database, connection.connection.id);

  const result = await platform.executeAction(
    connection.tenantId,
    capability.action,
    args,
    connection.connection.kit_id
  );
  if (!result.success) {
    // Los errores de la acción se devuelven como resultado con `isError`, no
    // como error de protocolo: así el modelo los ve y puede corregir.
    return toolError(id, result.error ?? 'La acción falló sin detalle.');
  }

  const rendered = await renderResult(result.data, {
    output: capability.output,
    args,
    resolveReference: async (action, referenceId) => {
      if (!action.endsWith('.getById')) return undefined;
      const resolved = await platform.executeAction(connection.tenantId, action, {
        id: referenceId,
      });
      return resolved.success ? resolved.data : undefined;
    },
  });
  const payload = {
    content: [{ type: 'text', text: rendered.text }],
    structuredContent: { data: rendered.data ?? null, truncated: rendered.truncated },
    isError: false,
  };
  // Solo se memoriza lo que salió bien: un fallo debe poder reintentarse.
  if (key) rememberExecution(key, payload);

  return ok(id, payload);
}

function effectiveArgs(
  capability: TenantCapability,
  requested: Record<string, unknown>
): Record<string, unknown> {
  if (capability.output?.kind !== 'collection') return requested;
  const hardMax = Math.min(Math.max(capability.output.maxLimit ?? 50, 1), 50);
  const defaultLimit = Math.min(Math.max(capability.output.defaultLimit ?? 20, 1), hardMax);
  const requestedLimit = Number.isInteger(requested.limit) ? Number(requested.limit) : defaultLimit;
  const requestedOffset = Number.isInteger(requested.offset) ? Number(requested.offset) : 0;
  return {
    ...requested,
    limit: Math.min(Math.max(requestedLimit, 1), hardMax),
    offset: Math.min(Math.max(requestedOffset, 0), 100_000),
  };
}

function toolError(id: string | number | null, message: string): JsonRpcResponse {
  return ok(id, { content: [{ type: 'text', text: message }], isError: true });
}
