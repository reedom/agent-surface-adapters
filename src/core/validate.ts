// Minimal, dependency-free JSON-Schema subset validator + JSON extraction.
//
// The surfaced lane has no native structured-output channel, so a workflow that
// declares a `schema` gets it validated here (in the Stop hook) against the
// agent's final message. Kept self-contained on purpose: pulling ajv would drag a
// dependency tree into nagi's bundled, self-contained dist. The subset covers what
// nagi workflows actually declare — object shapes with typed/enum properties and
// `required` — and validates nested objects/arrays shallowly by type.

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Pull the JSON object an agent was asked to emit out of its final message text.
 * Tolerates ```json fences and surrounding prose; returns undefined if none parses.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function typeOk(value: unknown, type: string | undefined): boolean {
  if (type === undefined) return true;
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

export function validateAgainstSchema(value: unknown, schema: JsonSchema, path = ''): ValidationResult {
  const where = path === '' ? '(root)' : path;
  const errors: string[] = [];

  if (!typeOk(value, schema.type)) {
    return { ok: false, errors: [`${where}: expected ${schema.type}`] };
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`${where}: must be one of ${JSON.stringify(schema.enum)}`);
  }
  if (schema.type === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${where}: missing required "${key}"`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in obj) {
        errors.push(...validateAgainstSchema(obj[key], sub, path === '' ? key : `${path}.${key}`).errors);
      }
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      errors.push(...validateAgainstSchema(item, schema.items as JsonSchema, `${path}[${i}]`).errors);
    });
  }
  return { ok: errors.length === 0, errors };
}
