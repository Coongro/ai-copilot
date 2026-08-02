/**
 * Validación de argumentos contra el subset de JSON Schema del contrato de
 * capacidades (COONG-288).
 *
 * El modelo del otro lado inventa argumentos: manda strings donde va número,
 * fechas con formato propio, campos que no existen. Sin esta capa, esos errores
 * llegan al handler de la action —o peor, a la base— como valores raros. Acá se
 * cortan y se devuelve un mensaje que el modelo pueda usar para corregirse.
 *
 * Valida lo mismo que el contrato admite y nada más: tipos escalares, `enum`,
 * `format`, `pattern`, objetos anidados con `additionalProperties: false` y
 * arrays homogéneos. No pretende ser un validador de JSON Schema general.
 */

const DATE_TIME = 'date-time';

/** Formatos que el contrato permite en un string. */
const FORMAT_PATTERNS: Record<string, RegExp> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  [DATE_TIME]: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
};

const FORMAT_HINTS: Record<string, string> = {
  date: 'AAAA-MM-DD',
  [DATE_TIME]: 'AAAA-MM-DDTHH:MM:SS',
  uuid: 'un UUID',
};

interface SchemaNode {
  type?: string;
  description?: string;
  enum?: unknown[];
  format?: string;
  pattern?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: SchemaNode;
  default?: unknown;
  const?: unknown;
}

/**
 * Aplica valores administrados por Builder antes de validar/ejecutar.
 * `const` siempre prevalece: un canal externo nunca puede alterar un campo
 * fijo. `default` solo completa ausentes. Funciona también dentro de `data`.
 */
export function applySchemaValues(
  schema: Record<string, unknown>,
  args: Record<string, unknown>
): Record<string, unknown> {
  return applyNode(schema as SchemaNode, args) as Record<string, unknown>;
}

function applyNode(schema: SchemaNode, value: unknown): unknown {
  if (schema.const !== undefined) return schema.const;
  if (value === undefined && schema.default !== undefined) return schema.default;
  if (
    (schema.type === 'object' || schema.properties) &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const source = value as Record<string, unknown>;
    const result = { ...source };
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
      const applied = applyNode(property, source[key]);
      if (applied !== undefined) result[key] = applied;
    }
    return result;
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    return value.map((item) => applyNode(schema.items, item));
  }
  return value;
}

/**
 * Valida `args` contra `schema`. Devuelve el primer problema encontrado en
 * lenguaje llano, o `null` si está todo bien.
 */
export function validateArgs(
  schema: Record<string, unknown>,
  args: Record<string, unknown>
): string | null {
  return validateNode(schema as SchemaNode, args, '');
}

function validateNode(schema: SchemaNode, value: unknown, path: string): string | null {
  const where = path || 'los argumentos';

  if (schema.type === 'object' || schema.properties) {
    return validateObject(schema, value, path);
  }
  if (schema.type === 'array') {
    return validateArray(schema, value, path);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return `${where} debe ser uno de: ${schema.enum.map((v) => String(v)).join(', ')}.`;
  }

  switch (schema.type) {
    case 'string':
      return validateString(schema, value, where);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : `${where} debe ser un número.`;
    case 'integer':
      return Number.isInteger(value) ? null : `${where} debe ser un número entero.`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${where} debe ser true o false.`;
    default:
      return null;
  }
}

function validateString(schema: SchemaNode, value: unknown, where: string): string | null {
  if (typeof value !== 'string') return `${where} debe ser texto.`;

  if (schema.format) {
    const pattern = FORMAT_PATTERNS[schema.format];
    if (pattern && !pattern.test(value)) {
      return `${where} debe tener formato ${FORMAT_HINTS[schema.format] ?? schema.format}.`;
    }
  }

  // `pattern` lo usan los montos para preservar decimales exactos como string.
  if (schema.pattern && !safeTest(schema.pattern, value)) {
    return `${where} no tiene el formato esperado${
      schema.description ? ` (${schema.description})` : ''
    }.`;
  }

  return null;
}

/**
 * El `pattern` viene del manifest de un plugin, no del modelo, pero una regex
 * malformada no debe tumbar la llamada: si no compila, no valida.
 */
function safeTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}

function validateObject(schema: SchemaNode, value: unknown, path: string): string | null {
  const where = path || 'los argumentos';
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `${where} debe ser un objeto.`;
  }

  const object = value as Record<string, unknown>;
  const properties = schema.properties ?? {};

  const shape = checkShape(schema, object, properties, where);
  if (shape) return shape;

  for (const [key, propertySchema] of Object.entries(properties)) {
    const propertyValue = object[key];
    // Un opcional ausente no se valida; el requerido ya se chequeó arriba.
    if (propertyValue === undefined || propertyValue === null) continue;
    const problem = validateNode(propertySchema, propertyValue, path ? `${path}.${key}` : key);
    if (problem) return problem;
  }

  return null;
}

/** Requeridos presentes y ningún campo fuera de los declarados. */
function checkShape(
  schema: SchemaNode,
  object: Record<string, unknown>,
  properties: Record<string, SchemaNode>,
  where: string
): string | null {
  const missing = (schema.required ?? []).filter(
    (key) => object[key] === undefined || object[key] === null
  );
  if (missing.length > 0) {
    return `Faltan datos requeridos en ${where}: ${missing.join(', ')}.`;
  }

  if (schema.additionalProperties !== false) return null;

  const unknownKeys = Object.keys(object).filter((key) => !(key in properties));
  if (unknownKeys.length === 0) return null;

  const valid = Object.keys(properties).join(', ') || '(ninguno)';
  return `No existe${unknownKeys.length > 1 ? 'n' : ''} ${unknownKeys.join(', ')} en ${where}. Campos válidos: ${valid}.`;
}

function validateArray(schema: SchemaNode, value: unknown, path: string): string | null {
  const where = path || 'los argumentos';
  if (!Array.isArray(value)) return `${where} debe ser una lista.`;
  if (!schema.items) return null;

  for (const [index, item] of value.entries()) {
    const problem = validateNode(schema.items, item, `${where}[${index}]`);
    if (problem) return problem;
  }
  return null;
}
