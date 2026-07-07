/**
 * Shape del contexto HTTP que el core pasa al handler (refleja
 * HttpEndpointContext del core sin acoplar al apps/api).
 */

export interface HttpUser {
  id: string | number;
  tenantId: string;
  email: string;
}

export interface JwtContext {
  body: unknown;
  query: Record<string, string>;
  headers: Record<string, string>;
  user?: HttpUser;
  database: unknown;
  /**
   * Resuelve, server-side, el contexto de negocio del kit activo del tenant
   * (el `.md` de `copilotContext` en su manifest). `null` si no hay kit con
   * contexto. Lo provee el core (HttpEndpointContext); lazy.
   */
  resolveCopilotContext?: () => Promise<string | null>;
}
