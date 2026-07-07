/**
 * Lifecycle del plugin (entry del manifest, runtime: "eager").
 *
 * `eager` registra el httpEndpoint `/turn` desde el boot del API, sin depender
 * de vistas (el plugin no tiene). No falla si falta la key — el endpoint
 * devolverá un error claro al invocarse.
 */

export function activate(): void {
  const hasKey = !!process.env.OPENROUTER_API_KEY?.trim();
  // eslint-disable-next-line no-console
  console.log(
    `[ai-copilot] activo. Motor LLM via plugin openrouter${hasKey ? '' : ' (¡falta OPENROUTER_API_KEY!)'}.`
  );
}

export function deactivate(): void {
  // Sin estado que limpiar.
}
