import Ajv, { type ValidateFunction } from 'ajv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SPEC_PATH = fileURLToPath(new URL('../../../reference/statsig/console-api-openapi-20240601.json', import.meta.url));

/** OpenAPI 3.0 → JSON Schema: `nullable: true` becomes a `null` alternative. */
function convert(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convert);
  if (!node || typeof node !== 'object') return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === 'nullable' || k === 'example' || k === 'discriminator') continue;
    out[k] = convert(v);
  }
  if (typeof out.$ref === 'string') out.$ref = (out.$ref as string).replace(/^#\/components\//, 'statsig#/components/');
  // OpenAPI 3.0 boolean exclusiveMinimum/Maximum → JSON Schema numeric form.
  for (const [ex, bound] of [['exclusiveMinimum', 'minimum'], ['exclusiveMaximum', 'maximum']] as const) {
    if (typeof out[ex] === 'boolean') {
      if (out[ex] === true && typeof out[bound] === 'number') {
        out[ex] = out[bound];
        delete out[bound];
      } else delete out[ex];
    }
  }
  if (src.nullable === true) {
    if (typeof out.type === 'string') {
      out.type = [out.type, 'null'];
      if (Array.isArray(out.enum)) out.enum = [...(out.enum as unknown[]), null];
      return out;
    }
    return { anyOf: [out, { type: 'null' }] };
  }
  return out;
}

/** Validates bodies against the real StatSig Console API OpenAPI response schemas. */
export class StatsigOpenApiValidator {
  private readonly spec: { paths: Record<string, Record<string, { responses: Record<string, any> }>>; components: unknown };
  private readonly ajv: Ajv;
  private readonly cache = new Map<string, ValidateFunction>();

  constructor() {
    this.spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
    this.ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
    this.ajv.addSchema({ $id: 'statsig', components: convert(this.spec.components) });
  }

  /** Validate against the `data` property of the n-th `allOf` branch of a 2xx response. */
  validateComponent(path: string, allOfIndex: number, data: unknown): string[] {
    const op = this.spec.paths[path]?.get;
    const code = Object.keys(op?.responses ?? {}).find((c) => c.startsWith('2'));
    const schema = code ? op?.responses[code]?.content?.['application/json']?.schema : undefined;
    const branch = schema?.allOf?.[allOfIndex]?.properties?.data;
    if (!branch) return [`no allOf[${allOfIndex}].data for ${path}`];
    const v = this.ajv.compile(convert(branch) as object);
    return v(data) ? [] : (v.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
  }

  /** Returns human-readable errors; empty array = valid. */
  validate(path: string, body: unknown, method = 'get', status?: string): string[] {
    const op = this.spec.paths[path]?.[method];
    if (!op) return [`no such operation in spec: ${method.toUpperCase()} ${path}`];
    const code = status ?? Object.keys(op.responses).find((c) => c.startsWith('2'));
    if (!code) return [`no 2xx response for ${path}`];
    const key = `${method} ${path} ${code}`;
    let v = this.cache.get(key);
    if (!v) {
      const schema = op.responses[code]?.content?.['application/json']?.schema;
      if (!schema) return [`no JSON schema for ${key}`];
      v = this.ajv.compile(convert(schema) as object);
      this.cache.set(key, v);
    }
    if (v(body)) return [];
    return (v.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}${e.params && 'allowedValues' in e.params ? ' ' + JSON.stringify(e.params.allowedValues) : ''}`);
  }
}
