import { HttpError, Transport, UnreachableError, type TransportOptions } from '@sslm/http';
import type { z } from 'zod';
import { LD_API_VERSION, LD_INSTANCES, type LdInstance, type LdInstanceId } from './instances.ts';
import {
  CallerIdentitySchema,
  ContextKindsSchema,
  EnvironmentSchema,
  EnvironmentsSchema,
  FlagsSchema,
  ProjectSchema,
  ProjectsSchema,
  TokenSchema,
  type LdCallerIdentity,
  type LdEnvironment,
  type LdFlagSummary,
  type LdProject,
  type LdToken,
} from './schemas.ts';

export interface LdSchemaIssue {
  path: string;
  issues: { path: string; message: string }[];
}

export interface LdClientOptions {
  instance: LdInstanceId | LdInstance;
  /** LD access token. Held in memory by this instance only; never logged or persisted. */
  token: string;
  transport?: Transport | TransportOptions;
  onSchemaIssue?: (i: LdSchemaIssue) => void;
}

export class LdAuthError extends Error {
  constructor(readonly status: number, readonly path: string) {
    super(status === 401 ? 'LaunchDarkly rejected the token (401).' : `LaunchDarkly denied access to ${path} (${status}).`);
    this.name = 'LdAuthError';
  }
}

export interface ProbeResult {
  path: string;
  status: number | 'unreachable';
  ok: boolean;
  body?: unknown;
}

/**
 * LaunchDarkly REST client. This session's version is READ-ONLY: it has no methods that write.
 * Writes (semantic patch, approvals, scheduled changes) arrive in M3 behind explicit user action.
 */
export class LdClient {
  readonly instance: LdInstance;
  readonly transport: Transport;
  readonly #token: string;
  private readonly onSchemaIssue: (i: LdSchemaIssue) => void;

  constructor(opts: LdClientOptions) {
    this.instance = typeof opts.instance === 'string' ? LD_INSTANCES[opts.instance] : opts.instance;
    this.#token = opts.token;
    // LD's 429s are readable (CORS headers on errors), but X-Ratelimit-* / Retry-After are not
    // exposed to JS (PLAN §3.1), so the AIMD limiter adapts to 429s.
    this.transport = opts.transport instanceof Transport ? opts.transport : new Transport({ retry: { retryOpaqueFailures: false }, ...opts.transport });
    this.onSchemaIssue = opts.onSchemaIssue ?? (() => undefined);
  }

  callerIdentity(signal?: AbortSignal): Promise<LdCallerIdentity> {
    return this.get('/caller-identity', CallerIdentitySchema, { signal });
  }

  getToken(id: string, signal?: AbortSignal): Promise<LdToken> {
    return this.get(`/tokens/${encodeURIComponent(id)}`, TokenSchema, { signal });
  }

  /** All projects (paged by offset). */
  async listProjects(signal?: AbortSignal): Promise<LdProject[]> {
    const out: LdProject[] = [];
    for (let offset = 0; offset < 10_000; offset += 100) {
      const page = await this.get('/projects', ProjectsSchema, { query: { limit: '100', offset: String(offset) }, signal });
      out.push(...page.items);
      if (page.items.length < 100 || (page.totalCount != null && out.length >= page.totalCount)) break;
    }
    return out;
  }

  getProject(projectKey: string, signal?: AbortSignal): Promise<LdProject> {
    return this.get(`/projects/${encodeURIComponent(projectKey)}`, ProjectSchema, { signal });
  }

  async listEnvironments(projectKey: string, signal?: AbortSignal): Promise<LdEnvironment[]> {
    const out: LdEnvironment[] = [];
    for (let offset = 0; offset < 10_000; offset += 100) {
      const page = await this.get(`/projects/${encodeURIComponent(projectKey)}/environments`, EnvironmentsSchema, { query: { limit: '100', offset: String(offset) }, signal });
      out.push(...page.items);
      if (page.items.length < 100 || (page.totalCount != null && out.length >= page.totalCount)) break;
    }
    return out;
  }

  getEnvironment(projectKey: string, envKey: string, signal?: AbortSignal): Promise<LdEnvironment> {
    return this.get(`/projects/${encodeURIComponent(projectKey)}/environments/${encodeURIComponent(envKey)}`, EnvironmentSchema, { signal });
  }

  /** Flag summaries (key, tags, on/off for `envKey`), paged. Read-only. */
  async listFlags(projectKey: string, opts: { envKey?: string; signal?: AbortSignal } = {}): Promise<LdFlagSummary[]> {
    const out: LdFlagSummary[] = [];
    for (let offset = 0; offset < 100_000; offset += 100) {
      const query: Record<string, string> = { limit: '100', offset: String(offset), summary: 'true' };
      if (opts.envKey) query.env = opts.envKey;
      const page = await this.get(`/flags/${encodeURIComponent(projectKey)}`, FlagsSchema, { query, signal: opts.signal });
      out.push(...page.items);
      if (page.items.length < 100 || (page.totalCount != null && out.length >= page.totalCount)) break;
    }
    return out;
  }

  listContextKinds(projectKey: string, signal?: AbortSignal) {
    return this.get(`/projects/${encodeURIComponent(projectKey)}/context-kinds`, ContextKindsSchema, { signal });
  }

  /**
   * GET a route and report its status without throwing (capability probing, PLAN §5.2).
   * Beta routes must be probed with the beta header: without it they 403 regardless of plan.
   */
  async probe(path: string, opts: { beta?: boolean; query?: Record<string, string>; signal?: AbortSignal } = {}): Promise<ProbeResult> {
    try {
      const res = await this.request(path, opts);
      return { path, status: res.status, ok: true, body: stripSdkKeys(res.body) };
    } catch (e) {
      if (e instanceof HttpError) return { path, status: e.status, ok: false, body: e.body };
      if (e instanceof UnreachableError) return { path, status: 'unreachable', ok: false };
      throw e;
    }
  }

  async get<S extends z.ZodType>(path: string, schema: S, opts: { beta?: boolean; query?: Record<string, string>; signal?: AbortSignal } = {}): Promise<z.output<S>> {
    let res;
    try {
      res = await this.request(path, opts);
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw new LdAuthError(e.status, path);
      throw e;
    }
    const body = stripSdkKeys(res.body);
    const parsed = schema.safeParse(body);
    if (parsed.success) return parsed.data;
    this.onSchemaIssue({ path, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    return body as z.output<S>;
  }

  private request(path: string, opts: { beta?: boolean; query?: Record<string, string>; signal?: AbortSignal }) {
    const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : '';
    return this.transport.request({
      method: 'GET',
      url: `${this.instance.origin}/api/v2${path}${qs}`,
      headers: { Authorization: this.#token, 'LD-API-Version': opts.beta ? 'beta' : LD_API_VERSION },
      signal: opts.signal,
    });
  }
}

const SDK_KEY_FIELDS = new Set(['apiKey', 'mobileKey']);

/**
 * Remove environment SDK keys anywhere in a response, before validation, so they can't leak via
 * the lenient "return the raw body" path either.
 */
export function stripSdkKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripSdkKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!SDK_KEY_FIELDS.has(k)) out[k] = stripSdkKeys(x);
    return out;
  }
  return v;
}
