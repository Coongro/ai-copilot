import type { ModuleDatabaseAPI } from '@coongro/plugin-sdk';

import { mcpUrlFor } from '../endpoints/connections.js';
import {
  createConnection,
  deleteConnection,
  listConnections,
  setConnectionEnabled,
  toConnectionProfile,
  type ConnectionSummary,
  type CreatedConnection,
} from '../mcp/connections.js';

/**
 * Gestión de las conexiones de agentes como repositorio RPC — el mismo contrato
 * que usa el resto de Coongro, para que la vista se componga en el Builder.
 *
 * La lógica vive en `mcp/connections.ts` (compartida con la autenticación del
 * endpoint MCP); acá solo se expone al motor de acciones.
 *
 * ⚠️ Este repositorio NO debe declarar `copilotCapabilities`: un agente que
 * pudiera crear conexiones se emitiría una de perfil administrador a sí mismo.
 * Las conexiones se administran desde la web, por una persona.
 */
export class ConnectionRepository {
  constructor(private readonly db: ModuleDatabaseAPI) {}

  async list(): Promise<ConnectionSummary[]> {
    return listConnections(this.db);
  }

  /**
   * Devuelve el token en claro UNA sola vez: después solo queda su hash. La
   * vista tiene que mostrarlo en ese momento o se pierde.
   */
  async create({
    data,
  }: {
    /** Keys de la entidad — es lo que manda el formulario generado. */
    data: { name?: string; profile?: string; kit_id?: string | null; expiresInDays?: number };
  }): Promise<CreatedConnection & { url: string }> {
    const name = data?.name?.trim();
    if (!name) throw new Error('La conexión necesita un nombre.');
    const profile = toConnectionProfile(data.profile);
    if (!profile) {
      throw new Error('Elegí un perfil: solo consulta, consulta y opera, o sin restricción.');
    }

    const created = await createConnection(this.db, {
      name,
      profile,
      kitId: data.kit_id?.trim() || null,
      expiresInDays: data.expiresInDays,
    });

    return { ...created, url: mcpUrlFor(created.token) };
  }

  /** Revocar corta el acceso del agente en su llamada siguiente. */
  async setEnabled({ id, enabled }: { id: string; enabled: boolean }): Promise<ConnectionSummary> {
    const updated = await setConnectionEnabled(this.db, id, enabled);
    if (!updated) throw new Error('La conexión no existe.');
    return updated;
  }

  async delete({ id }: { id: string }): Promise<{ deleted: boolean }> {
    const deleted = await deleteConnection(this.db, id);
    if (!deleted) throw new Error('La conexión no existe.');
    return { deleted };
  }
}
