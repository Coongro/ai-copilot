/**
 * Runtime MCP agentic (COONG-291): referencias nominales, confirmación
 * server-side con token de un solo uso, política por conexión y auditoría.
 * Los fixtures reproducen el corpus de alquileres.
 */

import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformAPI, TenantCapability, TenantDatabase } from '../endpoints/_context.js';

import { listAudit, resetAudit } from './audit.js';
import { resetConfirmations } from './confirmation.js';
import { resetLimits } from './limits.js';
import { handleMcpMessage, type JsonRpcResponse } from './protocol.js';
import { parseRefHandle, resolveRefArgs } from './resource-ref.js';

const TENANT = '8860ef55-9643-4163-b920-895a6142e0be';
const TOKEN = `cnx_${TENANT.replace(/-/g, '')}_${'a'.repeat(48)}`;
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');

const createContract: TenantCapability = {
  pluginId: '@coongro/leases',
  id: 'leases.contracts.create',
  action: 'leases.contracts.create',
  title: 'Crear contrato',
  description: 'Crea un contrato de alquiler.',
  effect: 'write',
  confirmation: 'always',
  inputSchema: {
    type: 'object',
    properties: {
      unitRef: {
        type: 'string',
        description: 'Unidad a alquilar.',
        ref: { resource: 'properties.units' },
      },
      startDate: { type: 'string', format: 'date', description: 'Inicio.' },
    },
    required: ['unitRef', 'startDate'],
    additionalProperties: false,
  },
};

const listUnits: TenantCapability = {
  pluginId: '@coongro/properties',
  id: 'properties.units.list',
  action: 'properties.units.list',
  title: 'Listar unidades',
  description: 'Unidades del cliente.',
  effect: 'read',
  confirmation: 'never',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

function makePlatform(
  options: {
    profile?: string;
    policy?: Record<string, unknown> | null;
    execute?: PlatformAPI['executeAction'];
  } = {}
) {
  const row = {
    id: 'cnx-1',
    name: 'Claude',
    channel: 'mcp',
    profile: options.profile ?? 'operator',
    kit_id: null,
    policy: options.policy ?? null,
    token_hash: TOKEN_HASH,
    token_hint: 'aaaaaa',
    capability_revision: null,
    enabled: true,
    expires_at: null,
    last_used_at: null,
    created_at: '2026-08-01 00:00:00',
    updated_at: '2026-08-01 00:00:00',
  };
  const executeAction =
    options.execute ?? vi.fn(() => Promise.resolve({ success: true, data: { id: 'contrato-1' } }));
  const database: TenantDatabase = {
    tenantId: TENANT,
    ormQuery: vi.fn(() => Promise.resolve([row])) as unknown as TenantDatabase['ormQuery'],
  };
  const platform: PlatformAPI = {
    databaseFor: () => database,
    listKits: () => Promise.resolve([]),
    listCopilotCapabilities: () =>
      Promise.resolve({ revision: 'rev-1', capabilities: [createContract, listUnits] }),
    executeAction,
  };
  return { platform, executeAction };
}

function toolsCall(name: string, args: Record<string, unknown> = {}) {
  return {
    jsonrpc: '2.0' as const,
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  };
}

async function call(message: unknown, platform: PlatformAPI): Promise<JsonRpcResponse> {
  return (await handleMcpMessage(message, TOKEN, platform)) as JsonRpcResponse;
}

type ToolResult = {
  content: { text: string }[];
  structuredContent?: { status?: string; confirmationToken?: string };
  isError: boolean;
};

beforeEach(() => {
  resetLimits();
  resetConfirmations();
  resetAudit();
});

describe('resource-ref', () => {
  it('parsea handles y rechaza formas inválidas', () => {
    expect(parseRefHandle('properties.units:01JABC')).toEqual({
      resource: 'properties.units',
      id: '01JABC',
    });
    expect(parseRefHandle('sin-separador')).toBeNull();
    expect(parseRefHandle(':x')).toBeNull();
  });

  it('resuelve refs anidadas y detecta cruces nominales', () => {
    const { args, errors } = resolveRefArgs(createContract.inputSchema, {
      unitRef: 'properties.units:01JUNIT',
      startDate: '2026-08-01',
    });
    expect(errors).toEqual([]);
    expect(args.unitRef).toBe('01JUNIT');

    const wrong = resolveRefArgs(createContract.inputSchema, {
      unitRef: 'contacts:01JOTRO',
      startDate: '2026-08-01',
    });
    expect(wrong.errors[0]).toMatch(/contacts/);
  });
});

describe('confirmación server-side', () => {
  // Regresión: el ciclo funcionaba leyendo el token de `structuredContent`, pero un
  // agente real solo puede usar lo que el CONTRATO le permite. Sin `confirmationToken`
  // en el inputSchema —y con `additionalProperties: false`— no tenía por dónde
  // mandarlo, así que ninguna escritura podía completarse por MCP.
  it('el contrato público deja llegar el token: declarado en las escrituras y a la vista en el texto', async () => {
    const { platform } = makePlatform();

    const list = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, platform);
    interface ListedTool {
      name: string;
      inputSchema: {
        properties?: Record<string, unknown>;
        required?: string[];
      };
    }
    const tools = (list.result as { tools: ListedTool[] }).tools;

    const write = tools.find((tool) => tool.name === 'leases_contracts_create');
    expect(write?.inputSchema.properties?.confirmationToken).toBeTruthy();
    // Opcional: la PRIMERA llamada es la que pide la confirmación y va sin token.
    expect(write?.inputSchema.required ?? []).not.toContain('confirmationToken');

    // Una lectura nunca confirma: no le ensuciamos el schema.
    const read = tools.find((tool) => tool.name !== 'leases_contracts_create');
    expect(read?.inputSchema.properties?.confirmationToken).toBeUndefined();

    const first = await call(
      toolsCall('leases_contracts_create', {
        unitRef: 'properties.units:01JUNIT',
        startDate: '2026-08-01',
      }),
      platform
    );
    const result = first.result as ToolResult;
    const token = result.structuredContent?.confirmationToken ?? '';
    expect(token).toBeTruthy();
    // El valor tiene que estar en el texto: no todos los clientes exponen el
    // structuredContent al modelo.
    expect(result.content[0].text).toContain(token);
  });

  it('la primera llamada no ejecuta: devuelve resumen y token; la segunda ejecuta', async () => {
    const { platform, executeAction } = makePlatform();
    const args = { unitRef: 'properties.units:01JUNIT', startDate: '2026-08-01' };

    const first = await call(toolsCall('leases_contracts_create', args), platform);
    const firstResult = first.result as ToolResult;
    expect(executeAction).not.toHaveBeenCalled();
    expect(firstResult.structuredContent?.status).toBe('confirmation_required');
    const token = firstResult.structuredContent?.confirmationToken;
    expect(token).toBeTruthy();

    const second = await call(
      toolsCall('leases_contracts_create', { ...args, confirmationToken: token }),
      platform
    );
    expect(executeAction).toHaveBeenCalledTimes(1);
    // La ref llegó RESUELTA al handler: id crudo, no handle.
    expect(executeAction).toHaveBeenCalledWith(
      TENANT,
      'leases.contracts.create',
      { unitRef: '01JUNIT', startDate: '2026-08-01' },
      null
    );
    expect((second.result as ToolResult).isError).toBe(false);
  });

  it('el token es de un solo uso y no vale si cambian los argumentos', async () => {
    const { platform, executeAction } = makePlatform();
    const args = { unitRef: 'properties.units:01JUNIT', startDate: '2026-08-01' };
    const first = await call(toolsCall('leases_contracts_create', args), platform);
    const token = (first.result as ToolResult).structuredContent?.confirmationToken;

    // Mismos args pero fecha cambiada: la confirmación anterior NO vale.
    const tampered = await call(
      toolsCall('leases_contracts_create', {
        ...args,
        startDate: '2026-12-31',
        confirmationToken: token,
      }),
      platform
    );
    expect(executeAction).not.toHaveBeenCalled();
    expect((tampered.result as ToolResult).structuredContent?.status).toBe('confirmation_required');

    // El token original ya fue consumido por el intento anterior.
    const replay = await call(
      toolsCall('leases_contracts_create', { ...args, confirmationToken: token }),
      platform
    );
    expect(executeAction).not.toHaveBeenCalled();
    expect((replay.result as ToolResult).structuredContent?.status).toBe('confirmation_required');
  });

  it('una referencia cruzada se rechaza antes de pedir confirmación', async () => {
    const { platform, executeAction } = makePlatform();
    const response = await call(
      toolsCall('leases_contracts_create', {
        unitRef: 'contacts:01JOTRO',
        startDate: '2026-08-01',
      }),
      platform
    );
    expect(executeAction).not.toHaveBeenCalled();
    const result = response.result as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/contacts/);
  });
});

describe('política por conexión', () => {
  it('deniedCapabilities oculta la tool aunque el perfil la permita', async () => {
    const { platform, executeAction } = makePlatform({
      policy: { deniedCapabilities: ['leases.contracts.create'] },
    });
    const response = await call(
      toolsCall('leases_contracts_create', {
        unitRef: 'properties.units:01JUNIT',
        startDate: '2026-08-01',
      }),
      platform
    );
    expect(executeAction).not.toHaveBeenCalled();
    expect(response.error?.code).toBe(-32602);
  });

  it('allowedCapabilities es lista blanca estricta', async () => {
    const { platform } = makePlatform({
      policy: { allowedCapabilities: ['properties.units.list'] },
    });
    const list = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, platform);
    const tools = (list.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(tools).toEqual(['properties_units_list']);
  });

  it('confirmationPolicy always exige confirmar hasta lecturas', async () => {
    const { platform, executeAction } = makePlatform({
      policy: { confirmationPolicy: 'always' },
    });
    const response = await call(toolsCall('properties_units_list'), platform);
    expect(executeAction).not.toHaveBeenCalled();
    expect((response.result as ToolResult).structuredContent?.status).toBe('confirmation_required');
  });
});

describe('auditoría', () => {
  it('registra ejecuciones, rechazos y confirmaciones pendientes', async () => {
    const { platform } = makePlatform();
    await call(toolsCall('properties_units_list'), platform);
    await call(
      toolsCall('leases_contracts_create', {
        unitRef: 'contacts:01JOTRO',
        startDate: '2026-08-01',
      }),
      platform
    );
    await call(
      toolsCall('leases_contracts_create', {
        unitRef: 'properties.units:01JUNIT',
        startDate: '2026-08-01',
      }),
      platform
    );

    const outcomes = listAudit().map((entry) => entry.outcome);
    expect(outcomes).toContain('ok');
    expect(outcomes).toContain('rejected');
    expect(outcomes).toContain('confirmation_required');
    const okEntry = listAudit().find((entry) => entry.outcome === 'ok');
    expect(okEntry?.tenantId).toBe(TENANT);
    expect(okEntry?.action).toBe('properties.units.list');
  });
});
