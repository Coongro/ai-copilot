import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformAPI, TenantCapability, TenantDatabase } from '../endpoints/_context.js';

import { resetLimits } from './limits.js';
import { handleMcpMessage, type JsonRpcResponse } from './protocol.js';

const TENANT = '8860ef55-9643-4163-b920-895a6142e0be';
const TOKEN = `cnx_${TENANT.replace(/-/g, '')}_${'a'.repeat(48)}`;
/** `authenticate` busca por el hash del token en claro; el fake debe traerlo. */
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');

function capability(overrides: Partial<TenantCapability> = {}): TenantCapability {
  return {
    pluginId: '@coongro/leases',
    id: 'leases.contracts.list',
    action: 'leases.contracts.list',
    title: 'Listar contratos',
    description: 'Lista los contratos.',
    effect: 'read',
    confirmation: 'never',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    ...overrides,
  };
}

const KIT_RENTALS = '@coongro/kit-rentals';
/** Plugin de OTRO kit del mismo espacio, para probar el aislamiento. */
const OTHER_KIT_PLUGIN = '@coongro/patients';

const CAPABILITIES = [
  capability(),
  capability({
    pluginId: OTHER_KIT_PLUGIN,
    id: 'patients.records.list',
    action: 'patients.records.list',
  }),
  capability({
    id: 'leases.contracts.create',
    action: 'leases.contracts.create',
    effect: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Datos del contrato',
          properties: { valor: { type: 'number', description: 'Valor' } },
          required: ['valor'],
          additionalProperties: false,
        },
      },
      required: ['data'],
      additionalProperties: false,
    },
  }),
  capability({
    id: 'leases.contracts.delete',
    action: 'leases.contracts.delete',
    effect: 'destructive',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Id del contrato' } },
      required: ['id'],
      additionalProperties: false,
    },
  }),
];

/**
 * Doble de la plataforma + de la fila de conexión. `authenticate` consulta la
 * base por el hash del token, así que el fake de `ormQuery` devuelve la fila que
 * el test quiera (o ninguna, para simular un token inválido).
 */
function makePlatform(options: {
  profile?: string;
  enabled?: boolean;
  expiresAt?: string | null;
  found?: boolean;
  execute?: PlatformAPI['executeAction'];
  capabilities?: TenantCapability[];
  /** Kit al que está atada la conexión; `null` = todo el espacio. */
  kitId?: string | null;
}) {
  const row = {
    id: 'cnx-1',
    name: 'Claude',
    channel: 'mcp',
    profile: options.profile ?? 'operator',
    kit_id: options.kitId ?? null,
    token_hash: TOKEN_HASH,
    token_hint: 'aaaaaa',
    capability_revision: null,
    enabled: options.enabled ?? true,
    expires_at: options.expiresAt ?? null,
    last_used_at: null,
    created_at: '2026-07-31 00:00:00',
    updated_at: '2026-07-31 00:00:00',
  };

  const executeAction =
    options.execute ??
    vi.fn(() => Promise.resolve({ success: true, data: [{ id: 'contrato-1' }] }));

  const database: TenantDatabase = {
    tenantId: TENANT,
    // El select de authenticate devuelve filas; el update de touchConnection, nada.
    ormQuery: vi.fn((queryFn: unknown) => {
      void queryFn;
      return Promise.resolve(options.found === false || !row.enabled ? [] : [row]);
    }) as unknown as TenantDatabase['ormQuery'],
  };

  const all = options.capabilities ?? CAPABILITIES;

  // Sustituto del filtrado por kit que hace el core: el kit de alquileres deja
  // fuera lo que aporta la veterinaria.
  const listCopilotCapabilities = vi.fn((_tenantId: string, kitPluginId?: string | null) =>
    Promise.resolve({
      revision: kitPluginId ? `rev-${kitPluginId}` : 'rev-1',
      capabilities:
        kitPluginId === KIT_RENTALS ? all.filter((c) => c.pluginId !== OTHER_KIT_PLUGIN) : all,
    })
  );

  const platform: PlatformAPI = {
    databaseFor: () => database,
    listKits: () =>
      Promise.resolve([
        { pluginId: KIT_RENTALS, displayName: 'Alquileres' },
        { pluginId: '@coongro/kit-veterinary', displayName: 'Veterinaria' },
      ]),
    listCopilotCapabilities,
    executeAction,
  };

  return { platform, executeAction, listCopilotCapabilities, row };
}

async function call(
  message: unknown,
  platform: PlatformAPI,
  token: string | undefined = TOKEN
): Promise<JsonRpcResponse> {
  const response = await handleMcpMessage(message, token, platform);
  return response as JsonRpcResponse;
}

function toolsCall(name: string, args: Record<string, unknown> = {}) {
  return {
    jsonrpc: '2.0' as const,
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  };
}

beforeEach(() => {
  resetLimits();
});

describe('handshake', () => {
  it('responde ping sin pedir credenciales', async () => {
    const { platform } = makePlatform({});
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'ping' }, platform, undefined);
    expect(response.result).toEqual({});
  });

  it('devuelve la versión de protocolo que pidió el cliente si la soportamos', async () => {
    const { platform } = makePlatform({});
    const response = await call(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      platform
    );
    expect((response.result as { protocolVersion: string }).protocolVersion).toBe('2024-11-05');
  });

  it('no responde a las notificaciones', async () => {
    const { platform } = makePlatform({});
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      TOKEN,
      platform
    );
    expect(response).toBeNull();
  });
});

describe('autenticación', () => {
  it('rechaza un token con formato inválido', async () => {
    const { platform } = makePlatform({});
    const response = await call(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      platform,
      'pegote'
    );
    expect(response.error?.code).toBe(-32001);
  });

  it('rechaza un token que no existe en la base', async () => {
    const { platform } = makePlatform({ found: false });
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, platform);
    expect(response.error?.code).toBe(-32001);
  });

  it('rechaza una conexión revocada', async () => {
    const { platform } = makePlatform({ enabled: false });
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, platform);
    expect(response.error?.code).toBe(-32001);
  });

  it('rechaza un token vencido', async () => {
    const { platform } = makePlatform({ expiresAt: '2020-01-01 00:00:00' });
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, platform);
    expect(response.error?.code).toBe(-32001);
  });
});

describe('perfiles', () => {
  const namesOf = (response: JsonRpcResponse) =>
    (response.result as { tools: { name: string }[] }).tools.map((t) => t.name);

  it('solo lectura publica únicamente las capacidades de lectura', async () => {
    const { platform } = makePlatform({ profile: 'readonly' });
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, platform);
    expect(namesOf(response)).toEqual(['leases_contracts_list', 'patients_records_list']);
  });

  it('operador ve lectura y escritura, pero no las destructivas', async () => {
    const { platform } = makePlatform({ profile: 'operator' });
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, platform);
    expect(namesOf(response)).toEqual([
      'leases_contracts_list',
      'patients_records_list',
      'leases_contracts_create',
    ]);
  });

  it('administrador ve todo', async () => {
    const { platform } = makePlatform({ profile: 'admin' });
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, platform);
    expect(namesOf(response)).toHaveLength(4);
  });

  it('un perfil desconocido degrada a solo lectura', async () => {
    const { platform } = makePlatform({ profile: 'superusuario' });
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, platform);
    expect(namesOf(response)).toEqual(['leases_contracts_list', 'patients_records_list']);
  });

  it('el filtro se aplica al ejecutar, no solo al listar', async () => {
    const { platform, executeAction } = makePlatform({ profile: 'operator' });
    const response = await call(toolsCall('leases_contracts_delete', { id: 'x' }), platform);
    expect(response.error?.code).toBe(-32602);
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('no publica campos const como argumentos controlables por el cliente', async () => {
    const fixed = capability({
      inputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description: 'Datos',
            properties: {
              name: { type: 'string', description: 'Nombre' },
              status: { type: 'string', description: 'Estado', const: 'vigente' },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
        required: ['data'],
        additionalProperties: false,
      },
    });
    const { platform } = makePlatform({ capabilities: [fixed] });
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, platform);
    const tool = (
      response.result as {
        tools: Array<{
          inputSchema: {
            properties: { data: { properties: Record<string, unknown> } };
          };
        }>;
      }
    ).tools[0];

    expect(tool.inputSchema.properties.data.properties.status).toBeUndefined();
    expect(tool.inputSchema.properties.data.properties.name).toBeDefined();
  });
});

describe('alcance por kit', () => {
  const namesOf = (response: JsonRpcResponse) =>
    (response.result as { tools: { name: string }[] }).tools.map((t) => t.name);

  it('sin kit, la conexión ve todo el espacio', async () => {
    const { platform, listCopilotCapabilities } = makePlatform({ profile: 'admin' });
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, platform);

    expect(listCopilotCapabilities).toHaveBeenCalledWith(TENANT, null);
    expect(namesOf(response)).toContain('patients_records_list');
  });

  it('atada a un kit, no publica lo de los otros kits del espacio', async () => {
    const { platform, listCopilotCapabilities } = makePlatform({
      profile: 'admin',
      kitId: KIT_RENTALS,
    });
    const response = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, platform);

    expect(listCopilotCapabilities).toHaveBeenCalledWith(TENANT, KIT_RENTALS);
    expect(namesOf(response)).not.toContain('patients_records_list');
    expect(namesOf(response)).toContain('leases_contracts_list');
  });

  it('el kit viaja al ejecutar, para que el core lo vuelva a comprobar', async () => {
    const { platform, executeAction } = makePlatform({ kitId: KIT_RENTALS });
    await call(toolsCall('leases_contracts_list'), platform);

    expect(executeAction).toHaveBeenCalledWith(TENANT, 'leases.contracts.list', {}, KIT_RENTALS);
  });

  it('no se puede ejecutar una capacidad de otro kit ni sabiendo su nombre', async () => {
    const { platform, executeAction } = makePlatform({ profile: 'admin', kitId: KIT_RENTALS });
    const response = await call(toolsCall('patients_records_list'), platform);

    expect(response.error?.code).toBe(-32602);
    expect(executeAction).not.toHaveBeenCalled();
  });
});

describe('tools/call', () => {
  it('ejecuta la acción y devuelve el resultado como texto', async () => {
    const { platform, executeAction } = makePlatform({});
    const response = await call(toolsCall('leases_contracts_list'), platform);

    expect(executeAction).toHaveBeenCalledWith(TENANT, 'leases.contracts.list', {}, null);
    const result = response.result as { content: { text: string }[]; isError: boolean };
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('contrato-1');
  });

  it('aplica proyección y límite antes de devolver una colección', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({
      id: String(index + 1),
      tenant_name: `Persona ${index + 1}`,
      tenant_id: `interno-${index + 1}`,
    }));
    const readable = capability({
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Cantidad' },
          offset: { type: 'integer', description: 'Inicio' },
        },
        additionalProperties: false,
      },
      output: {
        kind: 'collection',
        identifierKey: 'id',
        defaultLimit: 20,
        maxLimit: 50,
        fields: [{ key: 'tenant_name', name: 'tenantName', label: 'Inquilino' }],
      },
    });
    const execute = vi.fn(() => Promise.resolve({ success: true, data: rows }));
    const { platform } = makePlatform({ capabilities: [readable], execute });
    const response = await call(
      toolsCall('leases_contracts_list', { limit: 999, offset: 0 }),
      platform
    );

    expect(execute).toHaveBeenCalledWith(
      TENANT,
      'leases.contracts.list',
      { limit: 50, offset: 0 },
      null
    );
    const result = response.result as {
      content: { text: string }[];
      structuredContent: { data: { items: unknown[]; page: { hasMore: boolean } } };
    };
    expect(result.content[0].text).toContain('Mostrando 1-50 de 60 resultados (hay más).');
    expect(result.content[0].text).not.toContain('tenant_id');
    expect(result.structuredContent.data.items).toHaveLength(50);
    expect(result.structuredContent.data.page.hasMore).toBe(true);
  });

  it('no ejecuta si los argumentos no cumplen el schema', async () => {
    const { platform, executeAction } = makePlatform({});
    const response = await call(toolsCall('leases_contracts_list', { inventado: 1 }), platform);

    expect(executeAction).not.toHaveBeenCalled();
    expect((response.result as { isError: boolean }).isError).toBe(true);
  });

  it('inyecta const/default antes de ejecutar y no permite sobrescribir valores fijos', async () => {
    const save = capability({
      id: 'leases.contracts.sign',
      action: 'leases.contracts.sign',
      effect: 'write',
      inputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description: 'Datos del contrato',
            properties: {
              name: { type: 'string', description: 'Nombre' },
              status: { type: 'string', description: 'Estado', const: 'vigente' },
              active: { type: 'boolean', description: 'Activo', default: true },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
        required: ['data'],
        additionalProperties: false,
      },
    });
    const execute = vi.fn(() => Promise.resolve({ success: true, data: { id: 'ok' } }));
    const { platform } = makePlatform({ capabilities: [save], execute });

    await call(
      toolsCall('leases_contracts_sign', {
        data: { name: 'Contrato', status: 'manipulado' },
      }),
      platform
    );

    expect(execute).toHaveBeenCalledWith(
      TENANT,
      'leases.contracts.sign',
      { data: { name: 'Contrato', status: 'vigente', active: true } },
      null
    );
  });

  it('devuelve el fallo de la acción como resultado, no como error de protocolo', async () => {
    const { platform } = makePlatform({
      execute: () => Promise.resolve({ success: false, error: 'La unidad no existe' }),
    });
    const response = await call(toolsCall('leases_contracts_list'), platform);

    expect(response.error).toBeUndefined();
    const result = response.result as { content: { text: string }[]; isError: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('La unidad no existe');
  });

  it('no repite una escritura idéntica: la segunda devuelve el resultado guardado', async () => {
    const { platform, executeAction } = makePlatform({});
    const args = { data: { valor: 1 } };

    const first = await call(toolsCall('leases_contracts_create', args), platform);
    const second = await call(toolsCall('leases_contracts_create', args), platform);

    expect(executeAction).toHaveBeenCalledTimes(1);
    expect(second.result).toEqual(first.result);
  });

  it('un fallo no se memoriza: el reintento vuelve a ejecutar', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'timeout' })
      .mockResolvedValueOnce({ success: true, data: { id: 'ok' } });
    const { platform } = makePlatform({ execute });

    await call(toolsCall('leases_contracts_create', { data: { valor: 1 } }), platform);
    await call(toolsCall('leases_contracts_create', { data: { valor: 1 } }), platform);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('corta cuando la conexión supera su límite de llamadas', async () => {
    const { platform } = makePlatform({});
    for (let i = 0; i < 60; i++) {
      await call(toolsCall('leases_contracts_list'), platform);
    }
    const response = await call(toolsCall('leases_contracts_list'), platform);
    const result = response.result as { content: { text: string }[]; isError: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('límite');
  });
});

describe('métodos no implementados', () => {
  it('responde method not found a prompts y resources', async () => {
    const { platform } = makePlatform({});
    for (const method of ['prompts/list', 'resources/list']) {
      const response = await call({ jsonrpc: '2.0', id: 1, method }, platform);
      expect(response.error?.code).toBe(-32601);
    }
  });

  it('rechaza un mensaje que no es JSON-RPC 2.0', async () => {
    const { platform } = makePlatform({});
    const response = await call({ id: 1, method: 'tools/list' }, platform);
    expect(response.error?.code).toBe(-32600);
  });
});
