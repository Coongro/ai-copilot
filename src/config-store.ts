/**
 * Override del prompt del sistema editable en runtime — SOLO modo dev.
 *
 * Permite ajustar el system prompt del copiloto desde el dev panel sin
 * recompilar ni reiniciar. En producción `isDevMode()` es false y el endpoint
 * de escritura se niega: ahí manda el `SYSTEM_PROMPT` hardcodeado (default).
 *
 * Persistencia best-effort a un JSON (sobrevive `docker restart` dentro del
 * mismo contenedor). Si no se puede escribir, el override vive en memoria hasta
 * el próximo reinicio — aceptable para una herramienta de desarrollo.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CONFIG_FILE =
  process.env.AI_COPILOT_CONFIG_PATH?.trim() || join(tmpdir(), 'coongro-ai-copilot-config.json');

let cache: { prompt?: string } | null = null;

function load(): { prompt?: string } {
  if (cache) return cache;
  try {
    if (existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as { prompt?: unknown };
      cache =
        typeof parsed.prompt === 'string' && parsed.prompt.trim() ? { prompt: parsed.prompt } : {};
    } else {
      cache = {};
    }
  } catch {
    cache = {};
  }
  return cache;
}

function persist(data: { prompt?: string }): void {
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // Best-effort: si no se puede escribir, el override queda solo en memoria.
  }
}

/** Prompt override activo, o undefined si no hay (se usa el default). */
export function getPromptOverride(): string | undefined {
  return load().prompt;
}

/** Setea el override. Un string vacío/whitespace LO LIMPIA (vuelve al default). */
export function setPromptOverride(prompt: string): void {
  const trimmed = prompt.trim();
  cache = trimmed ? { prompt } : {};
  persist(cache);
}

export function clearPromptOverride(): void {
  cache = {};
  persist(cache);
}

/** true salvo en producción — gatea la escritura de config desde el dev panel. */
export function isDevMode(): boolean {
  return (process.env.NODE_ENV ?? '').toLowerCase() !== 'production';
}
