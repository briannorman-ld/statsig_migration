import { HttpError, Transport, UnreachableError, type TransportOptions } from '@sslm/http';
import type { z } from 'zod';
import { LD_API_VERSION, LD_INSTANCES, type LdInstance, type LdInstanceId } from './instances.ts';
import {
  CallerIdentitySchema,
  ContextKindsSchema,
  EnvironmentSchema,
  EnvironmentsSchema,
  ExperimentSchema,
  ExperimentsSchema,
  ExperimentationSettingsSchema,
  FlagSchema,
  MetricSchema,
  MetricsSchema,
  FlagsSchema,
  ProjectSchema,
  SegmentSchema,
  SegmentsSchema,
  ProjectsSchema,
  TokenSchema,
  type LdCallerIdentity,
  type LdEnvironment,
  type LdExperiment,
  type LdExperimentationSettings,
  type LdFlag,
  type LdMetric,
  type LdFlagSummary,
  type LdProject,
  type LdSegment,
  type LdToken,
} from './schemas.ts';

/** Tag on LD environments this app created (Mapping page), so a project reset removes only those. */
export const TAG_MIGRATED_ENV = 'statsig-migrated';

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

/** A failed LD write. `status` 405 on a flag PATCH means the environment requires approvals. */
export class LdWriteError extends Error {
  constructor(
    readonly status: number | 'unreachable',
    readonly path: string,
    readonly body: unknown,
  ) {
    super(ldErrorMessage(status, path, body));
    this.name = 'LdWriteError';
  }
}

function ldErrorMessage(status: number | 'unreachable', path: string, body: unknown): string {
  const msg = body && typeof body === 'object' && 'message' in body ? String((body as { message: unknown }).message) : undefined;
  if (status === 'unreachable') return `LaunchDarkly unreachable for ${path}.`;
  if (status === 405) return `Approval required for ${path} (405). Approval requests arrive with M4.`;
  return `LaunchDarkly ${status} for ${path}${msg ? `: ${msg}` : ''}`;
}

export type JsonPatchOp = { op: 'replace' | 'add' | 'remove' | 'test'; path: string; value?: unknown };

export interface SemanticPatch {
  environmentKey?: string;
  comment?: string;
  instructions: ({ kind: string } & Record<string, unknown>)[];
}

/**
 * LaunchDarkly REST client. Reads are lenient-validated; writes (PLAN §5.1) are only called by the
 * executor, after the user confirms a plan. Every write method returns the parsed response body.
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
    // Writes to one flag in quick succession hit LD's per-resource limits, so back off longer than
    // the transport default before giving up (the run can still be resumed after that).
    this.transport =
      opts.transport instanceof Transport ? opts.transport : new Transport({ ...opts.transport, retry: { retryOpaqueFailures: false, maxAttempts: 8, baseDelayMs: 1000, maxDelayMs: 30_000, ...opts.transport?.retry } });
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

  /** Full flag with every environment's configuration (pre-images, variation IDs). `null` if absent. */
  async getFlag(projectKey: string, key: string, signal?: AbortSignal): Promise<LdFlag | null> {
    try {
      return await this.get(`/flags/${encodeURIComponent(projectKey)}/${encodeURIComponent(key)}`, FlagSchema, { signal });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }

  async listSegments(projectKey: string, envKey: string, signal?: AbortSignal): Promise<LdSegment[]> {
    const out: LdSegment[] = [];
    for (let offset = 0; offset < 100_000; offset += 50) {
      const page = await this.get(`/segments/${encodeURIComponent(projectKey)}/${encodeURIComponent(envKey)}`, SegmentsSchema, { query: { limit: '50', offset: String(offset) }, signal });
      out.push(...page.items);
      if (page.items.length < 50 || (page.totalCount != null && out.length >= page.totalCount)) break;
    }
    return out;
  }

  async getSegment(projectKey: string, envKey: string, key: string, signal?: AbortSignal): Promise<LdSegment | null> {
    try {
      return await this.get(`/segments/${encodeURIComponent(projectKey)}/${encodeURIComponent(envKey)}/${encodeURIComponent(key)}`, SegmentSchema, { signal });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }

  // --- Experimentation reads ---------------------------------------------------------------------

  /** Every metric in the project (key, kind, event key, tags). 403 on plans without Experimentation. */
  async listMetrics(projectKey: string, signal?: AbortSignal): Promise<LdMetric[]> {
    const out: LdMetric[] = [];
    for (let offset = 0; offset < 100_000; offset += 50) {
      const page = await this.get(`/metrics/${encodeURIComponent(projectKey)}`, MetricsSchema, { query: { limit: '50', offset: String(offset) }, signal });
      const items = page.items ?? [];
      out.push(...items);
      if (items.length < 50 || (page.totalCount != null && out.length >= page.totalCount)) break;
    }
    return out;
  }

  async getMetric(projectKey: string, key: string, signal?: AbortSignal): Promise<LdMetric | null> {
    try {
      return await this.get(`/metrics/${encodeURIComponent(projectKey)}/${encodeURIComponent(key)}`, MetricSchema, { signal });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }

  /** Experiments (including bandits) in one environment, active and archived. */
  async listExperiments(projectKey: string, envKey: string, signal?: AbortSignal): Promise<LdExperiment[]> {
    const out: LdExperiment[] = [];
    for (let offset = 0; offset < 100_000; offset += 50) {
      const page = await this.get(`/projects/${encodeURIComponent(projectKey)}/environments/${encodeURIComponent(envKey)}/experiments`, ExperimentsSchema, {
        query: { limit: '50', offset: String(offset), lifecycleState: 'active,archived' },
        signal,
      });
      out.push(...page.items);
      const total = page.total_count ?? page.totalCount;
      if (page.items.length < 50 || (total != null && out.length >= total)) break;
    }
    return out;
  }

  async getExperiment(projectKey: string, envKey: string, key: string, signal?: AbortSignal): Promise<LdExperiment | null> {
    try {
      return await this.get(`/projects/${encodeURIComponent(projectKey)}/environments/${encodeURIComponent(envKey)}/experiments/${encodeURIComponent(key)}`, ExperimentSchema, { signal });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }

  getExperimentationSettings(projectKey: string, signal?: AbortSignal): Promise<LdExperimentationSettings> {
    return this.get(`/projects/${encodeURIComponent(projectKey)}/experimentation-settings`, ExperimentationSettingsSchema, { signal });
  }

  // --- Writes ---------------------------------------------------------------------------------

  /** POST /projects/{p}/environments (reference/launchdarkly/openapi.json EnvironmentPost: name, key, color required). */
  createEnvironment(projectKey: string, body: { key: string; name: string; color: string; critical?: boolean; tags?: string[] }): Promise<LdEnvironment> {
    return this.write('POST', `/projects/${encodeURIComponent(projectKey)}/environments`, body, EnvironmentSchema);
  }

  async deleteEnvironment(projectKey: string, envKey: string): Promise<void> {
    await this.write('DELETE', `/projects/${encodeURIComponent(projectKey)}/environments/${encodeURIComponent(envKey)}`, undefined, null);
  }

  createMetric(projectKey: string, body: Record<string, unknown>): Promise<LdMetric> {
    return this.write('POST', `/metrics/${encodeURIComponent(projectKey)}`, body, MetricSchema);
  }

  patchMetricJson(projectKey: string, key: string, patch: JsonPatchOp[], opts: { comment?: string } = {}): Promise<LdMetric> {
    return this.write('PATCH', `/metrics/${encodeURIComponent(projectKey)}/${encodeURIComponent(key)}`, { patch, ...(opts.comment ? { comment: opts.comment } : {}) }, MetricSchema);
  }

  async deleteMetric(projectKey: string, key: string): Promise<void> {
    await this.write('DELETE', `/metrics/${encodeURIComponent(projectKey)}/${encodeURIComponent(key)}`, undefined, null);
  }

  /** POST an experiment with its first iteration as a draft (`type: mab` for a bandit). */
  createExperiment(projectKey: string, envKey: string, body: Record<string, unknown>): Promise<LdExperiment> {
    return this.write('POST', `/projects/${encodeURIComponent(projectKey)}/environments/${encodeURIComponent(envKey)}/experiments`, body, ExperimentSchema);
  }

  /** Replaces the experiment's draft iteration. */
  createIteration(projectKey: string, envKey: string, key: string, body: Record<string, unknown>): Promise<LdExperiment> {
    return this.write('POST', `/projects/${encodeURIComponent(projectKey)}/environments/${encodeURIComponent(envKey)}/experiments/${encodeURIComponent(key)}/iterations`, body, ExperimentSchema);
  }

  /** Experiments only take semantic patches (`archiveExperiment`, `updateExperimentFields`, …). */
  patchExperimentSemantic(projectKey: string, envKey: string, key: string, patch: SemanticPatch): Promise<LdExperiment> {
    return this.write('PATCH', `/projects/${encodeURIComponent(projectKey)}/environments/${encodeURIComponent(envKey)}/experiments/${encodeURIComponent(key)}`, patch, ExperimentSchema, {
      contentType: 'application/json; domain-model=launchdarkly.semanticpatch',
    });
  }

  /** PUT replaces the whole list of randomization units. */
  putExperimentationSettings(projectKey: string, body: { randomizationUnits: { randomizationUnit: string; default?: boolean }[] }): Promise<LdExperimentationSettings> {
    return this.write('PUT', `/projects/${encodeURIComponent(projectKey)}/experimentation-settings`, body, ExperimentationSettingsSchema);
  }

  createFlag(projectKey: string, body: Record<string, unknown>): Promise<LdFlag> {
    return this.write('POST', `/flags/${encodeURIComponent(projectKey)}`, body, FlagSchema);
  }

  /** One atomic semantic patch (PLAN §5.1). `dryRun` validates without saving. */
  patchFlagSemantic(projectKey: string, key: string, patch: SemanticPatch, opts: { dryRun?: boolean } = {}): Promise<LdFlag> {
    return this.write('PATCH', `/flags/${encodeURIComponent(projectKey)}/${encodeURIComponent(key)}`, patch, FlagSchema, {
      contentType: 'application/json; domain-model=launchdarkly.semanticpatch',
      ...(opts.dryRun ? { query: { dryRun: 'true' } } : {}),
    });
  }

  patchFlagJson(projectKey: string, key: string, patch: JsonPatchOp[], opts: { comment?: string; dryRun?: boolean } = {}): Promise<LdFlag> {
    return this.write('PATCH', `/flags/${encodeURIComponent(projectKey)}/${encodeURIComponent(key)}`, { patch, ...(opts.comment ? { comment: opts.comment } : {}) }, FlagSchema, opts.dryRun ? { query: { dryRun: 'true' } } : {});
  }

  async deleteFlag(projectKey: string, key: string): Promise<void> {
    await this.write('DELETE', `/flags/${encodeURIComponent(projectKey)}/${encodeURIComponent(key)}`, undefined, null);
  }

  createSegment(projectKey: string, envKey: string, body: { key: string; name: string; description?: string; tags?: string[] }): Promise<LdSegment> {
    return this.write('POST', `/segments/${encodeURIComponent(projectKey)}/${encodeURIComponent(envKey)}`, body, SegmentSchema);
  }

  patchSegmentJson(projectKey: string, envKey: string, key: string, patch: JsonPatchOp[], opts: { comment?: string; dryRun?: boolean } = {}): Promise<LdSegment> {
    return this.write('PATCH', `/segments/${encodeURIComponent(projectKey)}/${encodeURIComponent(envKey)}/${encodeURIComponent(key)}`, { patch, ...(opts.comment ? { comment: opts.comment } : {}) }, SegmentSchema, opts.dryRun ? { query: { dryRun: 'true' } } : {});
  }

  async deleteSegment(projectKey: string, envKey: string, key: string): Promise<void> {
    await this.write('DELETE', `/segments/${encodeURIComponent(projectKey)}/${encodeURIComponent(envKey)}/${encodeURIComponent(key)}`, undefined, null);
  }

  /** PUT is an upsert; `archived: true` is how a context kind is "removed". */
  async putContextKind(projectKey: string, key: string, body: { name: string; description?: string; archived?: boolean }): Promise<void> {
    await this.write('PUT', `/projects/${encodeURIComponent(projectKey)}/context-kinds/${encodeURIComponent(key)}`, body, null);
  }

  private async write<S extends z.ZodType>(
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    schema: S | null,
    opts: { contentType?: string; query?: Record<string, string> } = {},
  ): Promise<z.output<S>> {
    const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : '';
    let res;
    try {
      res = await this.transport.request({
        method,
        url: `${this.instance.origin}/api/v2${path}${qs}`,
        headers: { Authorization: this.#token, 'LD-API-Version': LD_API_VERSION, ...(opts.contentType ? { 'Content-Type': opts.contentType } : {}) },
        body,
      });
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 401) throw new LdAuthError(401, path);
        throw new LdWriteError(e.status, path, stripSdkKeys(e.body));
      }
      if (e instanceof UnreachableError) throw new LdWriteError('unreachable', path, null);
      throw e;
    }
    const out = stripSdkKeys(res.body);
    if (!schema) return out as z.output<S>;
    const parsed = schema.safeParse(out);
    if (parsed.success) return parsed.data;
    this.onSchemaIssue({ path, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    return out as z.output<S>;
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
      if (e instanceof HttpError) return { path, status: e.status, ok: false, body: stripSdkKeys(e.body) };
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
