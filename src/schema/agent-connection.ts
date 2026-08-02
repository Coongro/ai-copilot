import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Conexión de un cliente de agente externo (Claude, ChatGPT, Codex…) al
 * Copilot headless del tenant.
 *
 * El `channel` es el protocolo, no el producto: hoy solo `mcp`, y cualquier
 * cliente compatible entra por ahí. WhatsApp y Telegram serán otros valores de
 * este mismo campo cuando existan sus adaptadores.
 *
 * Del token solo se guarda el hash: se muestra una única vez al crearlo. El
 * `token_hint` (últimos caracteres) existe para poder identificar cuál es cuál
 * en la lista sin exponer el secreto.
 */
export const agentConnectionTable = pgTable(
  'module_ai_copilot_agent_connections',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Nombre que le pone el usuario: "Claude de Lucía", "ChatGPT recepción". */
    name: text('name').notNull(),
    /** Protocolo del canal: `mcp` (único hoy). */
    channel: text('channel').notNull().default('mcp'),
    /** readonly · operator · admin — filtra qué capacidades se publican. */
    profile: text('profile').notNull().default('readonly'),
    /**
     * Kit al que queda atada la conexión (`@coongro/kit-*`). Acota lo que el
     * agente ve y ejecuta a los plugins de ese kit, igual que el contexto de kit
     * de una sesión web. `null` = todo el espacio (conexiones previas a la
     * columna, y tenants de un solo kit).
     */
    kit_id: text('kit_id'),
    token_hash: text('token_hash').notNull(),
    token_hint: text('token_hint').notNull(),
    /**
     * Revisión del catálogo vigente la última vez que el cliente listó tools.
     * Si el tenant instala o actualiza plugins, deja de coincidir con la revisión
     * actual y la conexión queda "pendiente de reaprobación" — los clientes
     * cachean el snapshot de herramientas aprobadas y no lo refrescan solos.
     */
    capability_revision: text('capability_revision'),
    enabled: boolean('enabled').notNull().default(true),
    /**
     * El token es un portador que termina pegado en un cliente ajeno: expira
     * para acotar la ventana si el link se filtra. `null` = sin vencimiento
     * (conexiones creadas antes de que existiera la columna).
     */
    expires_at: timestamp('expires_at', { mode: 'string' }),
    last_used_at: timestamp('last_used_at', { mode: 'string' }),
    created_at: timestamp('created_at', { mode: 'string' })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // El lookup por hash es la ruta de cada llamada del agente, y dos
    // conexiones no pueden compartir token.
    uniqueIndex('idx_ai_copilot_connections_token').on(table.token_hash),
  ]
);

export type AgentConnectionRow = typeof agentConnectionTable.$inferSelect;
