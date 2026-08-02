/**
 * Lógica custom de «Nueva conexión» (NuevaConexionView).
 *
 * Este archivo es TUYO: el Builder lo crea una sola vez y NUNCA lo pisa al
 * regenerar.
 *
 * Deliberadamente VACÍO: el alta la hace el bloque «Generar enlace»
 * (SecretReveal), que es el único que puede mostrar la URL —se ve una sola vez—.
 * Un `onSubmit` acá crearía una SEGUNDA conexión por cada una generada.
 */
import type { CustomHandlers } from '@coongro/plugin-sdk';

export const customHandlers: CustomHandlers = {};
