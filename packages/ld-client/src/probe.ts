import { LdAuthError, type LdClient, type ProbeResult } from './client.ts';
import type { LdAccess, LdEnvironment } from './schemas.ts';

export type CapabilityKey =
  | 'flags'
  | 'context_kinds'
  | 'prerequisites'
  | 'big_segments'
  | 'scheduled_changes'
  | 'approvals'
  | 'experimentation'
  | 'holdouts'
  | 'layers'
  | 'metrics'
  | 'metric_groups'
  | 'release_pipelines'
  | 'flag_links'
  | 'members'
  | 'teams'
  | 'warehouse_native';

/**
 * - available: probed and works
 * - not_permitted: the route exists but this token may not use it (403 / `_access.denied`)
 * - unavailable: the plan doesn't include it (404 / 405, or a 403 the beta header didn't fix)
 * - unknown: can't be probed without side effects; the first failed write decides (§5.2)
 * - manual: never possible through the API
 */
export type CapabilityStatus = 'available' | 'not_permitted' | 'unavailable' | 'unknown' | 'manual';

export interface Capability {
  key: CapabilityKey;
  label: string;
  status: CapabilityStatus;
  /** PLAN §5.2 "Typical requirement". */
  requirement: string;
  /** PLAN §5.2 "Fallback when unavailable". */
  fallback: string;
  evidence: string;
}

export interface TokenInfo {
  tokenKind?: string;
  authKind?: string;
  serviceToken?: boolean;
  tokenId?: string;
  tokenName?: string;
  memberId?: string;
  accountId?: string;
  role?: string;
  customRoleIds?: string[];
  /** `GET /tokens/{id}`: ok, or why it couldn't be read. */
  tokenLookup: 'ok' | 'forbidden' | 'not_found' | 'error' | 'skipped';
  warnings: string[];
}

export interface EnvironmentCapabilities {
  key: string;
  name: string;
  critical: boolean;
  flagApprovalsRequired: boolean;
  segmentApprovalsRequired: boolean;
  deniedActions: string[];
}

export interface CapabilityMatrix {
  probedAt: string;
  instance: string;
  projectKey: string;
  projectName: string;
  /** Named `tokenInfo`: the store refuses any key called `token` (assertNoSecrets). */
  tokenInfo: TokenInfo;
  projectAccess: { allowed: string[]; denied: string[] };
  environments: EnvironmentCapabilities[];
  capabilities: Capability[];
  /** Every probe's raw status, for the Settings page and debugging. */
  probes: { path: string; status: number | 'unreachable' }[];
}

const META: Record<CapabilityKey, { label: string; requirement: string; fallback: string }> = {
  flags: { label: 'Flags, rules, targets, segments', requirement: 'Writer', fallback: '—' },
  context_kinds: {
    label: 'Create context kinds',
    requirement: 'Possibly Admin / Project Admin',
    fallback: 'Generate a copyable list for an admin to create; SDK evaluations also auto-create kinds.',
  },
  prerequisites: { label: 'Prerequisites', requirement: 'Enterprise', fallback: "Inline the referenced gate's conditions, or decide." },
  big_segments: { label: 'Big / unbounded segments, CSV import', requirement: 'Enterprise', fallback: 'Split the list or decide.' },
  scheduled_changes: { label: 'Scheduled changes', requirement: 'Enterprise', fallback: 'Resolve time conditions statically, or decide.' },
  approvals: { label: 'Approvals', requirement: 'Enterprise', fallback: 'Approval-request fallback.' },
  experimentation: { label: 'Experiments', requirement: 'Experimentation add-on', fallback: 'Flags-only migration; experiments shown but blocked.' },
  holdouts: { label: 'Holdouts', requirement: 'Experimentation add-on', fallback: 'Flags-only migration.' },
  layers: { label: 'Layers', requirement: 'Experimentation add-on', fallback: 'Flags-only migration.' },
  metrics: { label: 'Metrics', requirement: 'Experimentation add-on', fallback: 'Metrics shown but blocked.' },
  metric_groups: { label: 'Metric groups (funnels)', requirement: 'Beta', fallback: 'Individual metrics.' },
  release_pipelines: { label: 'Release pipelines, guarded rollouts', requirement: 'Enterprise (beta)', fallback: 'Guidance only.' },
  flag_links: { label: 'Flag links', requirement: 'Beta', fallback: 'Custom property holding the StatSig permalink.' },
  members: { label: 'Member lookup by email', requirement: 'Admin / Enterprise', fallback: 'Default maintainer, or a manual member picker.' },
  teams: { label: 'Teams', requirement: 'Enterprise', fallback: 'Default maintainer.' },
  warehouse_native: {
    label: 'Warehouse-native data sources',
    requirement: 'UI only (Admin)',
    fallback: 'Guided manual setup checklist; metrics are created through the API once the data source exists.',
  },
};

export interface ProbeOptions {
  signal?: AbortSignal;
  onProgress?: (step: string) => void;
}

/**
 * PLAN §5.2 capability probe. Read-only: every call is a GET. There is no entitlements endpoint,
 * so availability is inferred from list-route status codes and `_access` on resources.
 */
export async function probeCapabilities(client: LdClient, projectKey: string, opts: ProbeOptions = {}): Promise<CapabilityMatrix> {
  const { signal } = opts;
  const probes: CapabilityMatrix['probes'] = [];
  const step = (s: string) => opts.onProgress?.(s);
  const p = encodeURIComponent(projectKey);

  // --- Token -------------------------------------------------------------------------------
  step('Reading token identity');
  const id = await client.callerIdentity(signal);
  const token: TokenInfo = {
    tokenKind: id.tokenKind ?? undefined,
    authKind: id.authKind ?? undefined,
    serviceToken: id.serviceToken ?? undefined,
    tokenId: id.tokenId ?? undefined,
    tokenName: id.tokenName ?? undefined,
    memberId: id.memberId ?? undefined,
    accountId: id.accountId ?? undefined,
    tokenLookup: 'skipped',
    warnings: [],
  };
  if (id.tokenId) {
    try {
      const t = await client.getToken(id.tokenId, signal);
      token.role = t.role ?? undefined;
      token.customRoleIds = t.customRoleIds ?? undefined;
      token.tokenLookup = 'ok';
      if (token.serviceToken === undefined && t.serviceToken != null) token.serviceToken = t.serviceToken;
    } catch (e) {
      token.tokenLookup = e instanceof LdAuthError ? 'forbidden' : 'error';
    }
  }
  if (token.serviceToken === false) {
    token.warnings.push('This is a personal access token. It stops working if its creator is downgraded or removed. Prefer a service token (Enterprise).');
  }
  if (token.role === 'reader') token.warnings.push('The token has the Reader role: migration writes will fail. Use a Writer (or scoped custom role) token.');

  // --- Project, environments, _access ------------------------------------------------------
  step('Reading project and environments');
  const project = await client.getProject(projectKey, signal);
  const projectAccess = accessLists(project._access);
  const envList = await client.listEnvironments(projectKey, signal);
  const environments: EnvironmentCapabilities[] = [];
  for (const e of envList) {
    // The list may omit approval settings; the single-environment GET includes them (§5.2).
    let detail: LdEnvironment = e;
    try {
      detail = await client.getEnvironment(projectKey, e.key, signal);
    } catch {
      /* keep the list version */
    }
    environments.push({
      key: detail.key,
      name: detail.name,
      critical: detail.critical ?? false,
      flagApprovalsRequired: detail.approvalSettings?.required ?? false,
      segmentApprovalsRequired: detail.resourceApprovalSettings?.segment?.required ?? false,
      deniedActions: accessLists(detail._access).denied,
    });
  }

  // --- Feature availability via list routes ------------------------------------------------
  step('Probing plan features');
  const firstEnv = envList[0]?.key;
  const routes: Record<string, { path: string; beta?: boolean; query?: Record<string, string> }> = {
    contextKinds: { path: `/projects/${p}/context-kinds` },
    layers: { path: `/projects/${p}/layers` },
    metrics: { path: `/metrics/${p}`, query: { limit: '1' } },
    metricGroups: { path: `/projects/${p}/metric-groups`, beta: true, query: { limit: '1' } },
    releasePipelines: { path: `/projects/${p}/release-pipelines`, beta: true, query: { limit: '1' } },
    members: { path: '/members', query: { limit: '1' } },
    teams: { path: '/teams', query: { limit: '1' } },
    ...(firstEnv
      ? {
          holdouts: { path: `/projects/${p}/environments/${encodeURIComponent(firstEnv)}/holdouts`, query: { limit: '1' } },
          experiments: { path: `/projects/${p}/environments/${encodeURIComponent(firstEnv)}/experiments`, query: { limit: '1' } },
        }
      : {}),
  };
  const results: Record<string, ProbeResult> = {};
  await Promise.all(
    Object.entries(routes).map(async ([k, r]) => {
      results[k] = await client.probe(r.path, { beta: r.beta, query: r.query, signal });
    }),
  );
  for (const r of Object.values(results)) probes.push({ path: r.path, status: r.status });

  const fromProbe = (r: ProbeResult | undefined, what: string): Pick<Capability, 'status' | 'evidence'> => {
    if (!r) return { status: 'unknown', evidence: `${what}: no environment to probe` };
    if (r.ok) return { status: 'available', evidence: `GET ${r.path} → ${r.status}` };
    if (r.status === 403) return { status: 'not_permitted', evidence: `GET ${r.path} → 403 (not permitted or not on this plan)` };
    if (r.status === 404 || r.status === 405) return { status: 'unavailable', evidence: `GET ${r.path} → ${r.status}` };
    return { status: 'unknown', evidence: `GET ${r.path} → ${r.status}` };
  };

  const denied = new Set(projectAccess.denied);
  const cap = (key: CapabilityKey, v: Pick<Capability, 'status' | 'evidence'>): Capability => ({ key, ...META[key], ...v });
  const anyApprovals = environments.some((e) => e.flagApprovalsRequired || e.segmentApprovalsRequired);

  const capabilities: Capability[] = [
    cap(
      'flags',
      denied.has('createFlag')
        ? { status: 'not_permitted', evidence: '_access.denied includes createFlag on the project' }
        : token.role === 'reader'
          ? { status: 'not_permitted', evidence: 'token role is reader' }
          : { status: 'available', evidence: token.role ? `token role ${token.role}` : 'no denial in project _access' },
    ),
    cap(
      'context_kinds',
      denied.has('createContextKind')
        ? { status: 'not_permitted', evidence: '_access.denied includes createContextKind' }
        : projectAccess.allowed.includes('createContextKind')
          ? { status: 'available', evidence: '_access.allowed includes createContextKind' }
          : results.contextKinds?.ok
            ? { status: 'unknown', evidence: 'context kinds are readable; create permission not stated in _access (verify with a Writer service token, PLAN §18 item 1)' }
            : fromProbe(results.contextKinds, 'context kinds'),
    ),
    cap('prerequisites', { status: 'unknown', evidence: 'Not probeable without a write; the first failed write updates this.' }),
    cap('big_segments', { status: 'unknown', evidence: 'Not probeable without a write; the first failed write updates this.' }),
    cap('scheduled_changes', { status: 'unknown', evidence: 'Not probeable without a write; the first failed write updates this.' }),
    cap(
      'approvals',
      anyApprovals
        ? { status: 'available', evidence: `required in: ${environments.filter((e) => e.flagApprovalsRequired || e.segmentApprovalsRequired).map((e) => e.key).join(', ')}` }
        : { status: 'unknown', evidence: 'No environment requires approvals (settings appear only when the feature is enabled).' },
    ),
    cap('experimentation', fromProbe(results.experiments, 'experiments')),
    cap('holdouts', fromProbe(results.holdouts, 'holdouts')),
    cap('layers', fromProbe(results.layers, 'layers')),
    cap('metrics', fromProbe(results.metrics, 'metrics')),
    cap('metric_groups', fromProbe(results.metricGroups, 'metric groups')),
    cap('release_pipelines', fromProbe(results.releasePipelines, 'release pipelines')),
    cap('flag_links', { status: 'unknown', evidence: 'Needs an existing flag to probe; checked on first use.' }),
    cap('members', fromProbe(results.members, 'members')),
    cap('teams', fromProbe(results.teams, 'teams')),
    cap('warehouse_native', { status: 'manual', evidence: 'Warehouse data sources cannot be created through the API.' }),
  ];

  return {
    probedAt: new Date().toISOString(),
    instance: client.instance.id,
    projectKey: project.key,
    projectName: project.name,
    tokenInfo: token,
    projectAccess,
    environments,
    capabilities,
    probes,
  };
}

function accessLists(a: LdAccess | null | undefined): { allowed: string[]; denied: string[] } {
  return {
    allowed: [...new Set((a?.allowed ?? []).map((x) => x.action))].sort(),
    denied: [...new Set((a?.denied ?? []).map((x) => x.action))].sort(),
  };
}
