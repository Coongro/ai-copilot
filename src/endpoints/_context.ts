/**
 * Shape del contexto HTTP que el core pasa al handler (refleja
 * HttpEndpointContext del core sin acoplar al apps/api).
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export interface HttpUser {
  id: string | number;
  tenantId: string;
  email: string;
}

/**
 * Sub-set de `ModuleDatabaseAPI` que usan los endpoints de este plugin. Se
 * declara acá para no depender de `@coongro/database-core` en el plugin.
 */
export interface TenantDatabase {
  ormQuery: <T>(queryFn: (db: PostgresJsDatabase) => Promise<T>) => Promise<T>;
  tenantId: string;
}

/** Capacidad headless declarada por un plugin del tenant (COONG-288). */
export interface TenantCapability {
  pluginId: string;
  id: string;
  action: string;
  title: string;
  description: string;
  effect: 'read' | 'write' | 'destructive';
  confirmation: 'never' | 'always';
  inputSchema: Record<string, unknown>;
  output?: CapabilityOutput;
}

export interface CapabilityOutputField {
  key: string;
  name: string;
  label: string;
  format?: 'text' | 'date' | 'date-time' | 'money' | 'number' | 'boolean';
  values?: Array<{ value: string; label: string }>;
  prefix?: string;
  suffix?: string;
  reference?: { action: string; displayField?: string };
}

export interface CapabilityOutput {
  kind: 'collection' | 'record';
  fields: CapabilityOutputField[];
  identifierKey?: string;
  defaultLimit?: number;
  maxLimit?: number;
}

/**
 * Primitivas de plataforma para adaptadores de canal (MCP y, más adelante,
 * WhatsApp/Telegram). Reciben `tenantId` explícito porque estos canales no
 * traen JWT: el adaptador resuelve el tenant desde su propio token.
 */
export interface PlatformAPI {
  databaseFor: (tenantId: string) => TenantDatabase;
  /** Kits instalados y activos del tenant, para elegir a cuál atar la conexión. */
  listKits: (tenantId: string) => Promise<Array<{ pluginId: string; displayName: string }>>;
  listCopilotCapabilities: (
    tenantId: string,
    kitPluginId?: string | null
  ) => Promise<{ revision: string; capabilities: TenantCapability[] }>;
  executeAction: (
    tenantId: string,
    actionId: string,
    args?: unknown,
    kitPluginId?: string | null
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
}

export interface JwtContext {
  body: unknown;
  query: Record<string, string>;
  headers: Record<string, string>;
  user?: HttpUser;
  /** `null` en endpoints con `auth: 'none'` — ahí se usa `platform.databaseFor`. */
  database: TenantDatabase | null;
  platform: PlatformAPI;
  /**
   * Resuelve, server-side, el contexto de negocio del kit activo del tenant
   * (el `.md` de `copilotContext` en su manifest). `null` si no hay kit con
   * contexto. Lo provee el core (HttpEndpointContext); lazy.
   */
  resolveCopilotContext?: () => Promise<string | null>;
}
