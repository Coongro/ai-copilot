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

import { recordAudit } from './audit.js';
import {
  completeConfirmation,
  confirmationSummary,
  issueConfirmation,
  redeemConfirmation,
  releaseConfirmation,
} from './confirmation.js';
import { authenticate, touchConnection, type AuthenticatedConnection } from './connections.js';
import { checkRateLimit, idempotencyKey, recallExecution, rememberExecution } from './limits.js';
import { applyPolicy, confirmationRequired, policyFor } from './policy.js';
import { renderResult } from './render.js';
import { resolveRefArgs } from './resource-ref.js';
import { indexByToolName, toTool } from './tools.js';
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
  // Perfil (efectos) + allow/deny de la política de la conexión: el mismo
  // catálogo compilado, filtrado por lo que ESTA conexión puede usar.
  const policy = policyFor(connection.connection);
  return {
    capabilities: applyPolicy(catalog.capabilities, policy),
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

  // El token de confirmación es un argumento RESERVADO del protocolo, no del
  // contrato: se separa antes de validar contra el schema.
  const { confirmationToken, ...bareArgs } = requestedArgs;

  const normalizedArgs = applySchemaValues(capability.inputSchema, bareArgs);
  const invalid = validateArgs(capability.inputSchema, normalizedArgs);
  if (invalid) return toolError(id, invalid);

  // Referencias nominales: un handle `recurso:id` se valida y se resuelve al
  // id crudo; una referencia de OTRO recurso se corta acá con mensaje útil.
  const refs = resolveRefArgs(capability.inputSchema, normalizedArgs);
  if (refs.errors.length) {
    recordAudit(auditBase(connection, capability, 'rejected', refs.errors.join('; ')));
    return toolError(id, refs.errors.join('\n'));
  }
  const args = effectiveArgs(capability, refs.args);

  const isWrite = capability.effect !== 'read';
  const limit = checkRateLimit(connection.connection.id, isWrite);
  if (!limit.allowed) return toolError(id, limit.message ?? 'Límite de uso alcanzado.');

  const gate = confirmationGate(id, connection, capability, args, confirmationToken);
  if ('response' in gate) return gate.response;
  /** Token redimido en ESTA llamada: la identidad del pedido, no la de sus datos. */
  const grantedToken = gate.token;

  // Idempotencia por HASH DE ARGUMENTOS: solo para escrituras que no confirman
  // (sin token no hay otra identidad del pedido). Las que confirman —hoy, todas
  // las publicadas— se identifican por su token. Deduplicar por datos fusionaba
  // dos altas legítimamente iguales (dos «Cochera», dos homónimos) devolviendo
  // el registro de la anterior con 200 y sin error: el alta se perdía en
  // silencio (COONG-300).
  const key =
    isWrite && grantedToken === null
      ? idempotencyKey(connection.connection.id, capability.id, args)
      : null;
  if (key) {
    const previous = recallExecution(key);
    if (previous) return ok(id, previous.result);
  }

  await touchConnection(connection.database, connection.connection.id);

  const startedAt = Date.now();
  const result = await runAction(platform, connection, capability, args, grantedToken);
  if (!result.success) {
    recordAudit({
      ...auditBase(connection, capability, 'error', result.error ?? undefined),
      durationMs: Date.now() - startedAt,
    });
    // Los errores de la acción se devuelven como resultado con `isError`, no
    // como error de protocolo: así el modelo los ve y puede corregir.
    return toolError(id, result.error ?? 'La acción falló sin detalle.');
  }
  recordAudit({
    ...auditBase(connection, capability, 'ok'),
    durationMs: Date.now() - startedAt,
  });

  const rendered = await renderResult(result.data, {
    output: capability.output,
    args,
    // El recurso sale del id de la action: `properties.buildings.list` proyecta
    // filas de `properties.buildings`. Salvo que el catálogo diga otra cosa:
    // una operación puede devolver el id de un recurso ajeno al suyo.
    resource: capability.output?.resource ?? capability.action.split('.').slice(0, -1).join('.'),
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
  // El token queda respondiendo por este resultado: si el cliente reintenta la
  // misma llamada, recibe esto en vez de ejecutar el alta por segunda vez.
  if (grantedToken) completeConfirmation(grantedToken, payload);

  return ok(id, payload);
}

/**
 * Ejecuta la acción sin dejar la confirmación colgada: si no llegó a
 * completarse —falló o cortó—, el token vuelve a estar pendiente. Sin esto el
 * pedido quedaría en `inFlight` hasta expirar y no habría forma de reintentarlo.
 */
async function runAction(
  platform: PlatformAPI,
  connection: AuthenticatedConnection,
  capability: TenantCapability,
  args: Record<string, unknown>,
  grantedToken: string | null
): Promise<Awaited<ReturnType<PlatformAPI['executeAction']>>> {
  try {
    const result = await platform.executeAction(
      connection.tenantId,
      capability.action,
      args,
      connection.connection.kit_id
    );
    if (!result.success && grantedToken) releaseConfirmation(grantedToken);
    return result;
  } catch (error) {
    if (grantedToken) releaseConfirmation(grantedToken);
    throw error;
  }
}

/**
 * Compuerta de confirmación: o hay respuesta que devolver ya mismo, o se puede
 * seguir a la ejecución. `token` es el de esta llamada cuando la operación
 * confirma, y `null` cuando no lo exige.
 */
type ConfirmationGate = { response: JsonRpcResponse } | { token: string | null };

/**
 * Confirmación server-side: la primera llamada de una operación que la exige no
 * ejecuta nada — devuelve el resumen y un token. Ejecutar requiere repetir la
 * llamada con `confirmationToken` y los MISMOS args.
 */
function confirmationGate(
  id: string | number | null,
  connection: AuthenticatedConnection,
  capability: TenantCapability,
  args: Record<string, unknown>,
  confirmationToken: unknown
): ConfirmationGate {
  if (!confirmationRequired(capability, policyFor(connection.connection))) return { token: null };

  const verdict = redeemConfirmation(
    confirmationToken,
    connection.connection.id,
    capability.id,
    args
  );
  // Reintento de transporte del mismo pedido: se devuelve lo ya ejecutado.
  if (verdict.status === 'replayed') return { response: ok(id, verdict.result) };
  if (verdict.status === 'inFlight') {
    return {
      response: toolError(
        id,
        'Esta operación ya está en curso con esta misma confirmación. Esperá el resultado antes de repetirla: reintentarla ahora la duplicaría.'
      ),
    };
  }
  if (verdict.status === 'granted') return { token: confirmationToken as string };

  const token = issueConfirmation(connection.connection.id, capability.id, args);
  const summary = confirmationSummary(capability.title, args);
  recordAudit(auditBase(connection, capability, 'confirmation_required'));
  return {
    response: ok(id, {
      content: [
        {
          type: 'text',
          // El token va en el TEXTO además de en `structuredContent`: no todos
          // los clientes MCP le muestran el structured al modelo, y sin el valor
          // a la vista la confirmación es imposible de completar.
          text: `Confirmación requerida: ${summary}\nSi la persona confirma, repetí exactamente la misma llamada agregando confirmationToken: "${token}".`,
        },
      ],
      structuredContent: { status: 'confirmation_required', summary, confirmationToken: token },
      isError: false,
    }),
  };
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

function auditBase(
  connection: AuthenticatedConnection,
  capability: TenantCapability,
  outcome: 'ok' | 'error' | 'rejected' | 'confirmation_required',
  detail?: string
) {
  return {
    connectionId: connection.connection.id,
    tenantId: connection.tenantId,
    capabilityId: capability.id,
    action: capability.action,
    effect: capability.effect,
    outcome,
    ...(detail ? { detail } : {}),
  };
}
