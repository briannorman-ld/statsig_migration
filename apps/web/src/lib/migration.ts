/**
 * Migration orchestration for the UI (PLAN §9 "Migrate flow"): profile → mapping → plan → dry
 * run → execute → undo. Domain logic lives in @sslm/mapper, @sslm/planner and @sslm/executor;
 * this module wires them to the store, the LD session and the StatSig source.
 */
import { useSyncExternalStore } from 'react';
import type { CanonicalSnapshot, Gate, Segment } from '@sslm/canonical';
import { Executor, newRun, type RunRecord } from '@sslm/executor';
import type { CapabilityMatrix, LdFlagSummary } from '@sslm/ld-client';
import { mapGate, mapSegment, reconcileProfile, type DecisionPoint, type EnvTarget, type GateMapResult, type IdLists, type MapperCapabilities, type MappingProfile, type Resolution, type SegmentMapResult } from '@sslm/mapper';
import { planMigration, type LdFlagState, type LdProjectState, type Plan } from '@sslm/planner';
import { StatsigConsoleClient } from '@sslm/statsig-client';
import type { SourceRecord } from '@sslm/store';
import { demoKey, startDemoMock } from './demo.ts';
import { ldClient, refreshLdState, type LdSession } from './ld.ts';
import { secrets } from './secrets.ts';
import { store } from './store.ts';

// ---------------------------------------------------------------------------------------------
// Profile and inputs
// ---------------------------------------------------------------------------------------------

/** Load the stored profile and fold in new environments / LD environments (never overwriting). */
export async function ensureProfile(workspaceId: string, snapshots: CanonicalSnapshot[], ldEnvs: { key: string; name: string }[], hints?: Record<string, string>): Promise<MappingProfile> {
  const stored = await store.getProfile(workspaceId);
  const base: MappingProfile = stored ?? { version: 1, sources: {}, attributes: {}, policies: {} };
  const next = ldEnvs.length ? reconcileProfile(base, snapshots, ldEnvs, hints) : base;
  if (!stored || JSON.stringify(next) !== JSON.stringify(stored)) await store.saveProfile(workspaceId, next);
  return next;
}

export function mapperCapabilities(matrix: CapabilityMatrix | undefined, contextKinds: string[] | undefined): MapperCapabilities {
  const cap = (k: string) => matrix?.capabilities.find((c) => c.key === k)?.status ?? 'unknown';
  return { prerequisites: cap('prerequisites'), contextKinds: cap('context_kinds'), existingContextKinds: contextKinds ?? ['user'] };
}

export function ldFlagState(f: LdFlagSummary): LdFlagState {
  return { key: f.key, tags: f.tags ?? [], customProperties: (f.customProperties ?? {}) as LdFlagState['customProperties'], kind: f.kind ?? null, archived: f.archived ?? null };
}

export function ldProjectState(ld: LdSession): LdProjectState {
  const segments: Record<string, Map<string, { key: string; tags: string[] }>> = {};
  for (const [env, list] of Object.entries(ld.segments ?? {})) segments[env] = new Map(list.map((s) => [s.key, { key: s.key, tags: s.tags ?? [] }]));
  return {
    flags: new Map((ld.flags?.items ?? []).map((f) => [f.key, ldFlagState(f)])),
    segments,
    contextKinds: ld.contextKinds ?? ['user'],
    criticalEnvs: (ld.matrix?.environments ?? []).filter((e) => e.critical || /prod/i.test(e.key)).map((e) => e.key),
  };
}

/** StatSig environment mapped to an LD environment for one source, if any. */
export function statsigEnvFor(profile: MappingProfile | undefined, sourceId: string, ldEnv: string): string | undefined {
  const m = profile?.sources[sourceId]?.envMapping ?? {};
  return Object.keys(m).find((k) => m[k] === ldEnv);
}

/** Every (StatSig env → LD env) pair a source can migrate. Without LD, StatSig envs map to themselves. */
export function envTargets(profile: MappingProfile | undefined, snapshot: CanonicalSnapshot, connected: boolean): EnvTarget[] {
  if (!connected) return snapshot.environments.map((e) => ({ statsig: e.name, ld: e.name }));
  const m = profile?.sources[snapshot.source.sourceId]?.envMapping ?? {};
  return snapshot.environments.filter((e) => m[e.name]).map((e) => ({ statsig: e.name, ld: m[e.name]! }));
}

export interface MappingInputs {
  profile: MappingProfile;
  resolutions: ReadonlyMap<string, Resolution>;
  capabilities: MapperCapabilities;
  idLists: IdLists;
  now: string;
}

export function mapGateFor(snapshot: CanonicalSnapshot, gate: Gate, env: EnvTarget, i: MappingInputs): GateMapResult {
  return mapGate({ canonical: { snapshot, idLists: i.idLists }, entity: gate, profile: i.profile, resolutions: i.resolutions, capabilities: i.capabilities, env, now: i.now });
}

export function mapSegmentFor(snapshot: CanonicalSnapshot, segment: Segment, env: EnvTarget, i: MappingInputs): SegmentMapResult {
  return mapSegment({ canonical: { snapshot, idLists: i.idLists }, entity: segment, profile: i.profile, resolutions: i.resolutions, capabilities: i.capabilities, env, now: i.now });
}

export interface DecisionInstance {
  decision: DecisionPoint;
  /** Where it was raised: which entity and environments. */
  entityId: string;
  envs: string[];
  resolvedWith?: { optionKey: string; via: 'resource' | 'policy' };
  stale?: Resolution;
}

/**
 * Every decision across the workspace: all live gates, plus segments, in every mapped environment.
 * Open ones come with the environments they apply to; resolved ones with their answer (decision log).
 */
export function collectDecisions(snapshots: CanonicalSnapshot[], profile: MappingProfile, connected: boolean, i: MappingInputs): DecisionInstance[] {
  const byId = new Map<string, DecisionInstance>();
  const add = (d: DecisionPoint, entityId: string, env: string, resolved?: DecisionInstance['resolvedWith'], stale?: Resolution) => {
    const x = byId.get(d.id) ?? { decision: d, entityId, envs: [], ...(resolved ? { resolvedWith: resolved } : {}), ...(stale ? { stale } : {}) };
    if (!x.envs.includes(env)) x.envs.push(env);
    byId.set(d.id, x);
  };
  for (const snap of snapshots) {
    for (const env of envTargets(profile, snap, connected)) {
      const results = [...snap.gates.filter((g) => !g.archived).map((g) => mapGateFor(snap, g, env, i)), ...snap.segments.filter((s) => !s.archived).map((s) => mapSegmentFor(snap, s, env, i))];
      for (const r of results) {
        const staleById = new Map(r.stale.map((s) => [s.decision.id, s.previous]));
        for (const d of r.unresolved) add(d, r.entityId, env.ld, undefined, staleById.get(d.id));
        for (const a of r.applied) add(a.decision, r.entityId, env.ld, { optionKey: a.optionKey, via: a.via });
      }
    }
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------------------------
// ID lists (PLAN §4.1: big lists are fetched on demand)
// ---------------------------------------------------------------------------------------------

export async function loadIdLists(workspaceId: string): Promise<IdLists> {
  return Object.fromEntries((await store.listIdLists(workspaceId)).map((r) => [r.uid, r.ids]));
}

/** Fetch members of deferred ID-list segments (≤15k IDs) from Console API sources. */
export async function fetchDeferredIdLists(workspaceId: string, sources: SourceRecord[], snapshots: CanonicalSnapshot[], have: IdLists, onProgress?: (m: string) => void): Promise<IdLists> {
  const out: IdLists = { ...have };
  for (const snap of snapshots) {
    const source = sources.find((s) => s.id === snap.source.sourceId);
    if (source?.kind !== 'console_api' || !source.baseUrl) continue;
    const pending = snap.segments.filter((s) => s.segmentType === 'id_list' && !s.archived && !s.idList?.ids && !s.idList?.hashed && (s.idList?.count ?? 0) <= 15_000 && !out[s.uid]);
    if (!pending.length) continue;
    let apiKey: string | undefined;
    if (source.isDemo) {
      await startDemoMock();
      apiKey = await demoKey();
    } else apiKey = secrets.get('statsig', source.id);
    if (!apiKey) continue;
    const client = new StatsigConsoleClient({ baseUrl: source.baseUrl, apiKey });
    for (const seg of pending) {
      onProgress?.(`Loading ${seg.idList?.count ?? ''} IDs for segment ${seg.id}…`);
      const list = await client.getIdList(seg.id);
      out[seg.uid] = list.ids;
      await store.saveIdList({ uid: seg.uid, workspaceId, sourceId: source.id, fetchedAt: new Date().toISOString(), ids: list.ids });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Plan and run
// ---------------------------------------------------------------------------------------------

export function buildPlan(input: { gates: string[]; ldEnvs: string[]; snapshots: CanonicalSnapshot[]; ld: LdSession } & MappingInputs): Plan {
  return planMigration({ gates: input.gates, ldEnvs: input.ldEnvs, snapshots: input.snapshots, idLists: input.idLists, profile: input.profile, resolutions: input.resolutions, capabilities: input.capabilities, ld: ldProjectState(input.ld), now: input.now });
}

// Live progress of the run executing in this tab (one at a time per workspace).
const active = new Map<string, RunRecord>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function useActiveRun(workspaceId: string): RunRecord | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => active.get(workspaceId),
  );
}

function executor(workspaceId: string, ld: LdSession): Executor {
  if (!ld.projectKey) throw new Error('Choose an LD project first.');
  return new Executor({
    client: ldClient(workspaceId),
    projectKey: ld.projectKey,
    journal: { save: (r) => store.saveRun(r) },
    ...(ld.identity?.tokenName ? { actor: ld.identity.tokenName } : {}),
    onProgress: (r) => {
      active.set(workspaceId, r);
      notify();
    },
  });
}

/**
 * Run with a Web Locks guard (one running tab per workspace) and a beforeunload warning
 * (PLAN §3.6). If the tab closes anyway, the journal lets the run resume on reopen.
 */
async function guarded<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  const warn = (e: BeforeUnloadEvent) => e.preventDefault();
  window.addEventListener('beforeunload', warn);
  try {
    if (!navigator.locks) return await fn();
    return (await navigator.locks.request(`sslm-run-${workspaceId}`, { ifAvailable: true }, async (lock) => {
      if (!lock) throw new Error('Another tab is running a migration for this workspace.');
      return fn();
    })) as T;
  } finally {
    window.removeEventListener('beforeunload', warn);
  }
}

export async function executePlan(workspaceId: string, ld: LdSession, plan: Plan, opts: { dryRun: boolean; label: string }): Promise<RunRecord> {
  const run = newRun({ id: crypto.randomUUID(), workspaceId, projectKey: ld.projectKey!, label: opts.label, dryRun: opts.dryRun, ...(ld.identity?.tokenName ? { actor: ld.identity.tokenName } : {}), steps: plan.steps, now: new Date() });
  return finishRun(workspaceId, ld, () => executor(workspaceId, ld).run(run), !opts.dryRun, plan);
}

export async function resumeRun(workspaceId: string, ld: LdSession, run: RunRecord): Promise<RunRecord> {
  return finishRun(workspaceId, ld, () => executor(workspaceId, ld).run(structuredClone(run)), true);
}

export async function undoRun(workspaceId: string, ld: LdSession, run: RunRecord): Promise<RunRecord> {
  return finishRun(workspaceId, ld, () => executor(workspaceId, ld).undo(structuredClone(run)), true);
}

async function finishRun(workspaceId: string, ld: LdSession, fn: () => Promise<RunRecord>, refresh: boolean, plan?: Plan): Promise<RunRecord> {
  try {
    const r = await guarded(workspaceId, fn);
    if (refresh) {
      const envs = [...new Set([...(plan?.steps ?? []), ...r.steps.map((s) => s.step)].flatMap((s) => ('ldEnv' in s ? [s.ldEnv] : [])))];
      await refreshLdState(workspaceId, { segmentEnvs: envs.length ? envs : Object.keys(ld.segments ?? {}) });
    }
    return r;
  } finally {
    active.delete(workspaceId);
    notify();
  }
}

/** A run left `running` in the journal but not executing in this tab was interrupted. */
export function isInterrupted(run: RunRecord, workspaceId: string): boolean {
  return (run.status === 'running' || run.status === 'undoing') && active.get(workspaceId)?.id !== run.id;
}

// ---------------------------------------------------------------------------------------------
// Decision log export (PLAN §8.2)
// ---------------------------------------------------------------------------------------------

export function decisionLogMarkdown(workspaceName: string, items: DecisionInstance[], resolutions: ReadonlyMap<string, Resolution>, profile: MappingProfile): string {
  const resolved = items.filter((i) => i.resolvedWith);
  const open = items.filter((i) => !i.resolvedWith);
  const label = (i: DecisionInstance) => i.decision.options.find((o) => o.key === i.resolvedWith?.optionKey)?.label ?? i.resolvedWith?.optionKey ?? '';
  const row = (i: DecisionInstance) => {
    const r = resolutions.get(i.decision.id);
    return `| ${i.decision.type} | ${i.decision.subject.id} | ${(i.decision.subject.location ?? '').replace(/\|/g, '/')} | ${i.envs.join(', ')} | ${label(i)} | ${i.resolvedWith?.via === 'policy' ? 'workspace policy' : (r?.decidedAt ?? '')} |`;
  };
  const policies = Object.entries(profile.policies);
  return [
    `# Decision log: ${workspaceName}`,
    '',
    `Exported ${new Date().toISOString()}. ${resolved.length} decided, ${open.length} open.`,
    '',
    ...(policies.length ? ['## Workspace policies', '', ...policies.map(([t, o]) => `- **${t}** → ${o}`), ''] : []),
    '## Decided',
    '',
    '| Type | Item | Where | LD environments | Answer | Decided |',
    '|---|---|---|---|---|---|',
    ...resolved.map(row),
    '',
    '## Open',
    '',
    '| Type | Severity | Item | Where | LD environments |',
    '|---|---|---|---|---|',
    ...open.map((i) => `| ${i.decision.type} | ${i.decision.severity} | ${i.decision.subject.id} | ${(i.decision.subject.location ?? '').replace(/\|/g, '/')} | ${i.envs.join(', ')} |`),
    '',
  ].join('\n');
}

export function decisionLogCsv(items: DecisionInstance[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = ['type', 'severity', 'item', 'location', 'ld_environments', 'status', 'answer', 'via'];
  const lines = items.map((i) =>
    [i.decision.type, i.decision.severity, i.decision.subject.id, i.decision.subject.location ?? '', i.envs.join(' '), i.resolvedWith ? 'decided' : 'open', i.resolvedWith?.optionKey ?? '', i.resolvedWith?.via ?? ''].map(esc).join(','),
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}

export function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
