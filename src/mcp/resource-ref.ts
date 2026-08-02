/**
 * ResourceRef en el runtime MCP (COONG-291).
 *
 * Un input marcado con `ref: { resource }` transporta un handle
 * `recurso:id` (o el id crudo). Antes de ejecutar, el runtime:
 *
 *  1. valida el TIPO de recurso (nominal: `contacts:X` jamás entra donde va
 *     `properties.units`),
 *  2. resuelve el handle al id real,
 *  3. entrega el id crudo al handler.
 *
 * La pertenencia al tenant la garantiza la ejecución misma: toda action corre
 * contra el schema del tenant de la conexión autenticada, así que un id de
 * otro tenant no existe donde la query lo busca.
 *
 * Espejo deliberado de `@coongro/module-core/agentic` (mismo formato de
 * handle): se duplican ~40 líneas porque este plugin no puede depender de una
 * versión del core aún no publicada. Al publicarse module-core con el módulo
 * agentic, esto puede reemplazarse por el import.
 */

const RESOURCE_PATTERN = /^[a-z0-9][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)*$/;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export interface ParsedRef {
  resource: string;
  id: string;
}

export function parseRefHandle(handle: unknown): ParsedRef | null {
  if (typeof handle !== 'string') return null;
  const separator = handle.lastIndexOf(':');
  if (separator <= 0 || separator === handle.length - 1) return null;
  const resource = handle.slice(0, separator);
  const id = handle.slice(separator + 1);
  if (!RESOURCE_PATTERN.test(resource) || !ID_PATTERN.test(id)) return null;
  return { resource, id };
}

interface RefSchemaNode {
  type?: string;
  ref?: { resource?: string };
  properties?: Record<string, RefSchemaNode>;
  items?: RefSchemaNode;
}

export interface RefResolutionResult {
  args: Record<string, unknown>;
  errors: string[];
}

/**
 * Recorre los argumentos ya validados y resuelve cada input `ref`. No muta la
 * entrada; devuelve los argumentos con ids crudos y los errores nominales.
 */
export function resolveRefArgs(
  schema: Record<string, unknown>,
  args: Record<string, unknown>
): RefResolutionResult {
  const errors: string[] = [];
  const resolved = visit(schema as RefSchemaNode, args, '', errors) as Record<string, unknown>;
  return { args: resolved, errors };
}

function visit(schema: RefSchemaNode, value: unknown, path: string, errors: string[]): unknown {
  if (schema.ref?.resource && typeof value === 'string') {
    return resolveOne(schema.ref.resource, value, path, errors);
  }
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const property = schema.properties[key];
      out[key] = property ? visit(property, item, path ? `${path}.${key}` : key, errors) : item;
    }
    return out;
  }
  if (schema.items && Array.isArray(value)) {
    return value.map((item, index) => visit(schema.items, item, `${path}[${index}]`, errors));
  }
  return value;
}

function resolveOne(expected: string, value: string, path: string, errors: string[]): string {
  const parsed = parseRefHandle(value);
  if (parsed) {
    if (parsed.resource !== expected) {
      errors.push(
        `${path}: la referencia es de ${parsed.resource}, no de ${expected}. Usá una referencia de ${expected} devuelta por una consulta previa.`
      );
      return value;
    }
    return parsed.id;
  }
  if (!ID_PATTERN.test(value)) {
    errors.push(`${path}: "${value}" no es un id ni un handle de ${expected}.`);
  }
  return value;
}
