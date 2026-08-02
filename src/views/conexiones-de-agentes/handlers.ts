/**
 * Lógica custom de «Conexiones de agentes» (ConexionesDeAgentesView).
 *
 * Este archivo es TUYO: el Builder lo crea una sola vez y NUNCA lo pisa al
 * regenerar. Los archivos regenerables (`conexiones-de-agentes.view.ts`,
 * `use-conexiones-de-agentes.ts`, `index.ts`) invocan estos puntos de extensión si
 * existen — acá va lo que el diseño no puede expresar.
 *
 * Revocar y reactivar no son un update de campos: son el interruptor de acceso
 * de un agente externo, y por eso van cableados a `setEnabled` en vez del
 * guardado genérico.
 */
import type { CustomHandlers } from '@coongro/plugin-sdk';

interface ConnectionRow {
  id?: string;
  name?: string;
}

export const customHandlers: CustomHandlers = {
  onAction: async (actionId, { execute, record, toast, reload }) => {
    const row = (record ?? {}) as ConnectionRow;
    if (!row.id) return;
    const label = row.name ?? 'La conexión';

    if (actionId === 'Revocar' || actionId === 'Reactivar') {
      const enabled = actionId === 'Reactivar';
      await execute('ai-copilot.connections.setEnabled', { id: row.id, enabled });
      if (enabled) {
        toast?.success('Conexión reactivada', `«${label}» vuelve a funcionar con la misma URL.`);
      } else {
        toast?.success('Conexión revocada', `«${label}» pierde el acceso en su próxima consulta.`);
      }
      reload?.();
      return;
    }

    if (actionId === 'Eliminar') {
      await execute('ai-copilot.connections.delete', { id: row.id });
      toast?.success('Conexión eliminada', `La URL de «${label}» ya no sirve.`);
      reload?.();
    }
  },
};
