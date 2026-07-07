/**
 * @coongro/ai-copilot — Entry point principal (browser-safe)
 *
 * Exporta el panel del copiloto (bloque drawer) y sus tipos públicos.
 * NO exportar handlers de endpoints (usan process.env / server-only).
 */

export { CopilotDrawer } from './panel/index.js';
export type { IntelligenceLevel } from './panel/types.js';
