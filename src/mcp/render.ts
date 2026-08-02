/**
 * Presentación segura del resultado de una action para agentes externos.
 *
 * El contrato generado por el Builder decide qué campos salen y cómo se leen;
 * este adaptador aplica el límite aunque un repositorio legacy lo ignore.
 */

import type { CapabilityOutput, CapabilityOutputField } from '../endpoints/_context.js';

const DEFAULT_MAX_ROWS = 50;
const DEFAULT_MAX_CHARS = 60_000;
const MAX_FIELD_CHARS = 1_000;

function envLimit(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface RenderedResult {
  text: string;
  /** Datos efectivamente enviados (ya proyectados y recortados). */
  data: unknown;
  truncated: boolean;
}

export interface RenderResultOptions {
  output?: CapabilityOutput;
  args?: Record<string, unknown>;
  resolveReference?: (action: string, id: string) => Promise<unknown>;
}

export async function renderResult(
  data: unknown,
  options: RenderResultOptions = {}
): Promise<RenderedResult> {
  if (data === undefined || data === null) {
    return { text: 'La acción se ejecutó correctamente.', data: null, truncated: false };
  }
  if (options.output?.kind === 'collection') {
    const rendered = await renderCollection(data, options.output, options);
    if (rendered) return rendered;
  }
  if (options.output?.kind === 'record' && isRecord(data)) {
    return renderRecord(data, options.output, options);
  }
  if (typeof data === 'string') return clampText(data, data, false);

  // Compatibilidad con capacidades manuales/legacy sin contrato de salida.
  const maxRows = envLimit('AI_COPILOT_MCP_MAX_ROWS', DEFAULT_MAX_ROWS);
  if (Array.isArray(data) && data.length > maxRows) {
    const shown = data.slice(0, maxRows);
    const note =
      `\n\nSe muestran ${maxRows} de ${data.length} resultados. ` +
      'Pedí un subconjunto más específico si necesitás el resto.';
    return clampText(stringify(shown) + note, shown, true);
  }
  return clampText(stringify(data), data, false);
}

interface PageEnvelope {
  items: unknown[];
  total?: number;
  hasMore?: boolean;
}

function pageEnvelope(data: unknown): PageEnvelope | null {
  if (Array.isArray(data)) return { items: data };
  if (!isRecord(data) || !Array.isArray(data.items)) return null;
  return {
    items: data.items,
    total: typeof data.total === 'number' ? data.total : undefined,
    hasMore: typeof data.hasMore === 'boolean' ? data.hasMore : undefined,
  };
}

async function renderCollection(
  data: unknown,
  output: CapabilityOutput,
  options: RenderResultOptions
): Promise<RenderedResult | null> {
  const envelope = pageEnvelope(data);
  if (!envelope) return null;
  const page = collectionWindow(data, envelope, output, options.args);
  const projector = createProjector(output, options.resolveReference);
  const rawProjected = await Promise.all(
    page.rows.filter(isRecord).map((row) => projector.project(row))
  );
  const projected = fitProjected(rawProjected);
  const clippedBySize = projected.length < rawProjected.length;
  const hasMore = page.hasMore || clippedBySize;
  const structured = {
    items: projected.map((entry) => entry.data),
    page: {
      offset: page.offset,
      limit: page.limit,
      returned: projected.length,
      total: page.total,
      hasMore,
    },
  };
  const from = projected.length ? page.offset + 1 : 0;
  const to = page.offset + projected.length;
  const heading = projected.length
    ? `Mostrando ${from}-${to} de ${page.total} resultados${hasMore ? ' (hay más)' : ''}.`
    : 'No hay resultados para esta página.';
  const lines = projected.map(
    (entry, index) => `${page.offset + index + 1}. ${entry.text || 'Sin datos visibles.'}`
  );
  return clampText([heading, ...lines].join('\n'), structured, hasMore);
}

function collectionWindow(
  data: unknown,
  envelope: PageEnvelope,
  output: CapabilityOutput,
  args: Record<string, unknown> | undefined
) {
  const globalMax = envLimit('AI_COPILOT_MCP_MAX_ROWS', DEFAULT_MAX_ROWS);
  const hardMax = Math.min(Math.max(output.maxLimit ?? DEFAULT_MAX_ROWS, 1), globalMax);
  const limit = Math.min(positiveInteger(args?.limit, output.defaultLimit ?? 20), hardMax);
  const offset = positiveInteger(args?.offset, 0, true);
  const alreadyPaged = !Array.isArray(data);
  const rows = alreadyPaged
    ? envelope.items.slice(0, limit)
    : envelope.items.slice(offset, offset + limit);
  const total =
    envelope.total ?? (alreadyPaged ? offset + envelope.items.length : envelope.items.length);
  const inferredMore = alreadyPaged
    ? rows.length === limit && offset + rows.length < total
    : offset + rows.length < total;
  return { rows, limit, offset, total, hasMore: envelope.hasMore ?? inferredMore };
}

function positiveInteger(value: unknown, fallback: number, allowZero = false): number {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

function fitProjected<T extends { data: unknown; text: string }>(items: T[]): T[] {
  const budget = envLimit('AI_COPILOT_MCP_MAX_CHARS', DEFAULT_MAX_CHARS);
  const accepted: T[] = [];
  let used = 0;
  for (const item of items) {
    const size = item.text.length + stringify(item.data).length;
    if (accepted.length > 0 && used + size > budget) break;
    accepted.push(item);
    used += size;
  }
  return accepted;
}

async function renderRecord(
  row: Record<string, unknown>,
  output: CapabilityOutput,
  options: RenderResultOptions
): Promise<RenderedResult> {
  const projected = await createProjector(output, options.resolveReference).project(row);
  return clampText(projected.text || 'Registro sin datos visibles.', projected.data, false);
}

function createProjector(
  output: CapabilityOutput,
  resolveReference?: RenderResultOptions['resolveReference']
) {
  const cache = new Map<string, Promise<unknown>>();
  let lookups = 0;

  const resolve = (field: CapabilityOutputField, value: unknown): Promise<unknown> => {
    if (!field.reference || !resolveReference || value === null || value === undefined) {
      return Promise.resolve(value);
    }
    const id = String(value);
    const key = `${field.reference.action}:${id}`;
    let pending = cache.get(key);
    if (pending === undefined) {
      if (lookups >= 100) return Promise.resolve(undefined);
      lookups += 1;
      pending = resolveReference(field.reference.action, id);
      cache.set(key, pending);
    }
    return pending.then((record) => referenceLabel(record, field.reference?.displayField));
  };

  return {
    async project(row: Record<string, unknown>) {
      const data: Record<string, unknown> = {};
      const text: string[] = [];
      const identifier = output.identifierKey ? row[output.identifierKey] : undefined;
      if (identifier !== undefined && identifier !== null) data._ref = String(identifier);
      for (const field of output.fields) {
        const resolved = await resolve(field, row[field.key]);
        const formatted = formatValue(resolved, field);
        if (formatted === null) continue;
        data[field.name] = formatted;
        text.push(`${field.label}: ${formatted}`);
      }
      return { data, text: text.join(' · ') };
    },
  };
}

function referenceLabel(record: unknown, displayField?: string): unknown {
  if (!isRecord(record)) return undefined;
  if (displayField && record[displayField] !== undefined) return record[displayField];
  return record.name ?? record.title ?? record.label ?? record.description;
}

function formatValue(value: unknown, field: CapabilityOutputField): string | null {
  if (value === undefined || value === null || value === '') return null;
  const mapped = field.values?.find((entry) => entry.value === String(value));
  const formatted = formatByType(value, mapped?.label ?? String(value), field.format);
  const decorated = `${field.prefix ?? (field.format === 'money' ? '$ ' : '')}${formatted}${field.suffix ?? ''}`;
  return decorated.length > MAX_FIELD_CHARS
    ? `${decorated.slice(0, MAX_FIELD_CHARS - 1)}…`
    : decorated;
}

function formatByType(
  rawValue: unknown,
  value: string,
  format: CapabilityOutputField['format']
): string {
  switch (format) {
    case 'date':
      return formatDate(value);
    case 'date-time':
      return formatDateTime(value);
    case 'money':
    case 'number':
      return formatDecimal(value);
    case 'boolean':
      return rawValue === true || value === 'true' ? 'Sí' : 'No';
    default:
      return value;
  }
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

/** Agrupa un decimal string sin convertirlo a number ni perder precisión. */
function formatDecimal(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;
  const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimals = match[3] ? ',' + match[3] : '';
  return `${match[1]}${grouped}${decimals}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampText(text: string, data: unknown, truncated: boolean): RenderedResult {
  const maxChars = envLimit('AI_COPILOT_MCP_MAX_CHARS', DEFAULT_MAX_CHARS);
  if (text.length <= maxChars) return { text, data, truncated };
  return {
    text: `${text.slice(0, maxChars)}\n\n[Respuesta recortada por tamaño.]`,
    data,
    truncated: true,
  };
}

function stringify(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}
