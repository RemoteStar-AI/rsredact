/**
 * OpenAI's structured outputs accept a subset of JSON Schema when `strict` is
 * on, and a schema outside that subset fails the request rather than degrading.
 * Two rules bite in practice: every property of an object must appear in
 * `required` (an optional field is expressed as a nullable one instead), and
 * validation keywords like `minimum` are rejected outright.
 *
 * RS Redact's own schemas already comply. This exists so a caller's custom
 * target schema does too, without them having to know the dialect.
 */

/** Keywords the strict subset rejects. Dropping them loses hints, not meaning. */
const UNSUPPORTED = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'default',
  'examples',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'patternProperties',
]);

export function toStrictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toStrictSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const input = schema as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (UNSUPPORTED.has(key)) continue;
    output[key] = key === 'properties' ? mapProperties(value) : toStrictSchema(value);
  }

  if (output.type === 'object' && output.properties && typeof output.properties === 'object') {
    const properties = output.properties as Record<string, unknown>;
    const declared = new Set((Array.isArray(input.required) ? input.required : []) as string[]);

    // Anything the caller left optional becomes required-but-nullable, which is
    // how the strict subset expresses "may be absent".
    for (const name of Object.keys(properties)) {
      if (declared.has(name)) continue;
      properties[name] = makeNullable(properties[name]);
    }
    output.required = Object.keys(properties);
    output.additionalProperties = false;
  }

  return output;
}

function mapProperties(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(value as Record<string, unknown>)) {
    output[name] = toStrictSchema(schema);
  }
  return output;
}

function makeNullable(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  const record = { ...(schema as Record<string, unknown>) };
  const type = record.type;
  if (typeof type === 'string') {
    record.type = type === 'null' ? type : [type, 'null'];
  } else if (Array.isArray(type) && !type.includes('null')) {
    record.type = [...type, 'null'];
  }
  return record;
}
