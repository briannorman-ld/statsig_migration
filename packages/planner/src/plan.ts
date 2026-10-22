/**
 * The planner (PLAN §9 "Migrate flow" step 2, §10.4): selected gates × LD environments →
 * dependency closure (segments, context kinds, prerequisite gates), collision checks against
 * what's already in LD, and an ordered list of idempotent steps. Pure: LD state is an input.
 */
import type { CanonicalSnapshot, Gate } from '@sslm/canonical';
import {
  decisionPoint,
  lookupResolution,
  mapGate,
  mapSegment,
  sourceTag,
  TAG_MIGRATED,
  type DecisionPoint,
  type DesiredFlagEnv,
  type DesiredFlagShell,
  type DesiredSegment,
  type FidelityReport,
  type GateMapResult,
  type IdLists,
  type MapperCapabilities,
  type MappingProfile,
  type Resolution,
  type SegmentMapResult,
  type StaleDecision,
} from '@sslm/mapper';

export interface LdFlagState {
  key: string;
  tags: string[];
  customProperties: Record<string, { name?: string | null; value?: string[] | null }>;
  kind?: string | null;
  archived?: boolean | null;
}

export interface LdSegmentState {
  key: string;
  tags: string[];
}

/** What the planner needs to know about the LD project (read by the app before planning). */
export interface LdProjectState {
  flags: ReadonlyMap<string, LdFlagState>;
  /** Segments per LD environment key. */
  segments: Readonly<Record<string, ReadonlyMap<string, LdSegmentState>>>;
  contextKinds: string[];
  /** LD environments that need a typed confirmation (`critical`, or production). */
  criticalEnvs: string[];
}

export interface PlanRequest {
  /** Gate uids to migrate. */
  gates: string[];
  ldEnvs: string[];
  snapshots: CanonicalSnapshot[];
  idLists?: IdLists;
  profile: MappingProfile;
  resolutions: ReadonlyMap<string, Resolution>;
  capabilities: MapperCapabilities;
  ld: LdProjectState;
  now: string;
}

export interface Provenance {
  sourceAlias: string;
  statsigType: 'gate';
  statsigId: string;
  statsigVersion?: number;
  statsigFingerprint: string;
  decisionSetHash: string;
}

export type PlanStep =
  | { id: string; deps: string[]; op: 'ensure_context_kind'; key: string; name: string; unitType: string }
  | { id: string; deps: string[]; op: 'upsert_segment'; ldEnv: string; key: string; exists: boolean; adopt: boolean; desired: DesiredSegment; provenance: Omit<Provenance, 'statsigType'> & { statsigType: 'segment' } }
  | { id: string; deps: string[]; op: 'upsert_flag_shell'; key: string; exists: boolean; adopt: boolean; desired: DesiredFlagShell }
  | {
      id: string;
      deps: string[];
      op: 'update_flag_env';
      key: string;
      ldEnv: string;
      statsigEnv: string;
      /** Values of the flag's variations, in the order `desired` indexes them. */
      variations: unknown[];
      desired: DesiredFlagEnv;
      provenance: Provenance;
    };

export type ItemStatus = 'ready' | 'blocked' | 'skipped' | 'error';

export interface PlanItem {
  uid: string;
  kind: 'gate' | 'segment';
  entityId: string;
  sourceId: string;
  ldKey: string;
  ldEnv: string;
  statsigEnv?: string;
  status: ItemStatus;
  /** True when pulled in by another item (a segment, or a prerequisite gate). */
  dependency: boolean;
  requiredBy: string[];
  reason?: string;
  fidelity?: FidelityReport;
  decisions: DecisionPoint[];
  exists: boolean;
}

export interface Plan {
  items: PlanItem[];
  steps: PlanStep[];
  /** Every open decision across the plan, deduplicated by id. */
  decisions: DecisionPoint[];
  stale: StaleDecision[];
  errors: string[];
  /** LD environments in this plan that need a typed confirmation (PLAN §9 step 5). */
  confirmEnvs: string[];
  /** True when every requested item is ready (nothing blocked or failing). */
  ready: boolean;
  /** Rough write count, for the duration estimate (PLAN §15). */
  requests: number;
}

/**
 * "Use recommended for all *choice* decisions" (PLAN §8.2). Blocking and acknowledge decisions
 * are left for the user.
 */
export function recommendedResolutions(ds: DecisionPoint[], decidedAt: string): Resolution[] {
  return ds
    .filter((d) => d.severity === 'choice' && d.recommended)
    .map((d) => ({ id: d.id, type: d.type, optionKey: d.recommended!, scope: 'resource' as const, fingerprint: d.fingerprint, decidedAt }));
}

/** `statsig.sync.<env>`: `[fingerprint, version, syncedAt, decisionSetHash]` (PLAN §3.3). */
export const syncPropertyKey = (ldEnv: string) => `statsig.sync.${ldEnv}`;

export function planMigration(req: PlanRequest): Plan {
  const errors: string[] = [];
  const items = new Map<string, PlanItem>();
  const decisions = new Map<string, DecisionPoint>();
  const stale = new Map<string, StaleDecision>();
  const steps = new Map<string, PlanStep>();
  const snapshotOf = new Map(req.snapshots.map((s) => [s.source.sourceId, s]));
  const gatesByUid = new Map(req.snapshots.flatMap((s) => s.gates.map((g) => [g.uid, g] as const)));
  const shellOwner = new Map<string, string>();

  const addDecisions = (item: PlanItem, ds: DecisionPoint[], st: StaleDecision[]) => {
    for (const d of ds) {
      decisions.set(d.id, d);
      if (!item.decisions.some((x) => x.id === d.id)) item.decisions.push(d);
    }
    for (const s of st) stale.set(s.decision.id, s);
  };

  const collision = (item: PlanItem, subject: DecisionPoint['subject'], ldKey: string, what: 'flag' | 'segment', where: string): 'adopt' | 'skip' | 'open' => {
    const dp = decisionPoint({
      type: 'key_collision',
      severity: 'blocking',
      subject: { ...subject, location: where },
      path: `${what}:${ldKey}${what === 'segment' ? `:${where}` : ''}`,
      title: `LD ${what} “${ldKey}” already exists`,
      explanation: `A ${what} with this key exists in LD and wasn't created by this app. Adopting it overwrites its ${what === 'flag' ? 'targeting in the migrated environments' : 'rules and targets'} on every sync; the current state is saved first so the run can be undone.`,
      sourceFragment: { key: ldKey, kind: what },
      options: [
        { key: 'adopt', label: 'Adopt it (link and overwrite on sync)', explanation: 'The existing LD resource becomes the migration target. A pre-image is kept for undo.', resultingFidelity: 'full' },
        { key: 'skip', label: 'Skip this item', explanation: 'Leave the LD resource alone and keep the item in StatSig.', resultingFidelity: 'skipped' },
      ],
    });
    const l = lookupResolution(dp, req.resolutions, req.profile);
    if (l.status === 'resolved') return l.optionKey === 'adopt' ? 'adopt' : 'skip';
    addDecisions(item, [dp], l.stale ? [{ decision: dp, previous: l.stale }] : []);
    return 'open';
  };

  const envFor = (sourceId: string, ldEnv: string): string | null => {
    const mapping = req.profile.sources[sourceId]?.envMapping ?? {};
    const matches = Object.entries(mapping).filter(([, v]) => v === ldEnv).map(([k]) => k);
    if (matches.length > 1) {
      errors.push(`StatSig environments ${matches.join(' and ')} of one source both map to LD “${ldEnv}”. Map at most one per source.`);
      return null;
    }
    return matches[0] ?? null;
  };

  const ensureKinds = (deps: { kind: string; key: string; entityId?: string }[]): string[] => {
    const out: string[] = [];
    for (const d of deps) {
      if (d.kind !== 'context_kind') continue;
      const id = `context_kind:${d.key}`;
      if (!req.ld.contextKinds.includes(d.key) && !steps.has(id)) steps.set(id, { id, deps: [], op: 'ensure_context_kind', key: d.key, name: d.key, unitType: d.entityId ?? d.key });
      if (steps.has(id)) out.push(id);
    }
    return out;
  };

  const planSegment = (snapshot: CanonicalSnapshot, segmentId: string, statsigEnv: string, ldEnv: string, requiredBy: string): { stepId?: string; ok: boolean; reason?: string } => {
    const seg = snapshot.segments.find((s) => s.id === segmentId);
    if (!seg) return { ok: false, reason: `segment “${segmentId}” not found` };
    const itemKey = `${seg.uid}|${ldEnv}`;
    const existing = items.get(itemKey);
    if (existing) {
      existing.requiredBy.push(requiredBy);
      return existing.status === 'ready' ? { ok: true, stepId: `segment:${ldEnv}:${existing.ldKey}` } : { ok: false, reason: `segment “${segmentId}” is ${existing.status}` };
    }
    const r: SegmentMapResult = mapSegment({ canonical: { snapshot, idLists: req.idLists }, entity: seg, profile: req.profile, resolutions: req.resolutions, capabilities: req.capabilities, env: { statsig: statsigEnv, ld: ldEnv }, now: req.now });
    const ldSeg = req.ld.segments[ldEnv]?.get(r.segmentKey);
    const item: PlanItem = { uid: seg.uid, kind: 'segment', entityId: seg.id, sourceId: seg.source.sourceId, ldKey: r.segmentKey, ldEnv, statsigEnv, status: 'ready', dependency: true, requiredBy: [requiredBy], fidelity: r.fidelity, decisions: [], exists: !!ldSeg };
    items.set(itemKey, item);
    addDecisions(item, r.unresolved, r.stale);
    if (r.skipped || !r.desired) return finishItem(item, 'skipped', r.skipped ?? 'not migratable');
    let adopt = false;
    if (ldSeg && !ownsSegment(ldSeg, snapshot.source.alias)) {
      const c = collision(item, { sourceId: seg.source.sourceId, kind: 'segment', uid: seg.uid, id: seg.id }, r.segmentKey, 'segment', ldEnv);
      if (c === 'skip') return finishItem(item, 'skipped', `LD segment “${r.segmentKey}” exists and was not adopted`);
      if (c === 'open') return finishItem(item, 'blocked', `LD segment “${r.segmentKey}” already exists`);
      adopt = true;
    }
    if (r.unresolved.length) return finishItem(item, 'blocked', `${r.unresolved.length} open decision${r.unresolved.length === 1 ? '' : 's'}`);
    const stepId = `segment:${ldEnv}:${r.segmentKey}`;
    steps.set(stepId, {
      id: stepId,
      deps: ensureKinds(r.dependencies),
      op: 'upsert_segment',
      ldEnv,
      key: r.segmentKey,
      exists: !!ldSeg,
      adopt,
      desired: r.desired,
      provenance: { sourceAlias: snapshot.source.alias, statsigType: 'segment', statsigId: seg.id, ...(seg.version !== undefined ? { statsigVersion: seg.version } : {}), statsigFingerprint: r.statsigFingerprint, decisionSetHash: r.decisionSetHash },
    });
    return { ok: true, stepId };
  };

  const finishItem = (item: PlanItem, status: ItemStatus, reason: string) => {
    item.status = status;
    item.reason = reason;
    return { ok: false, reason: `${item.kind} “${item.entityId}” is ${status}: ${reason}` };
  };

  const planGate = (gate: Gate, ldEnv: string, requiredBy: string | null, stack: string[]): { ok: boolean; reason?: string; stepId?: string } => {
    const itemKey = `${gate.uid}|${ldEnv}`;
    const existing = items.get(itemKey);
    if (existing) {
      if (requiredBy) existing.requiredBy.push(requiredBy);
      if (stack.includes(gate.uid)) {
        errors.push(`Prerequisites form a cycle: ${[...stack, gate.uid].map((u) => gatesByUid.get(u)?.id ?? u).join(' → ')}.`);
        return { ok: false, reason: 'prerequisite cycle' };
      }
      return existing.status === 'ready' ? { ok: true, stepId: `env:${ldEnv}:${existing.ldKey}` } : { ok: false, reason: `gate “${gate.id}” is ${existing.status}` };
    }
    const snapshot = snapshotOf.get(gate.source.sourceId)!;
    const statsigEnv = envFor(gate.source.sourceId, ldEnv);
    const item: PlanItem = { uid: gate.uid, kind: 'gate', entityId: gate.id, sourceId: gate.source.sourceId, ldKey: gate.id, ldEnv, status: 'ready', dependency: requiredBy !== null, requiredBy: requiredBy ? [requiredBy] : [], decisions: [], exists: false };
    items.set(itemKey, item);
    if (!statsigEnv) return finishItem(item, 'error', `no StatSig environment of ${snapshot.source.alias} is mapped to LD “${ldEnv}”`);
    item.statsigEnv = statsigEnv;

    const r: GateMapResult = mapGate({ canonical: { snapshot, idLists: req.idLists }, entity: gate, profile: req.profile, resolutions: req.resolutions, capabilities: req.capabilities, env: { statsig: statsigEnv, ld: ldEnv }, now: req.now });
    item.ldKey = r.flagKey;
    item.fidelity = r.fidelity;
    addDecisions(item, r.unresolved, r.stale);
    if (r.skipped) return finishItem(item, 'skipped', r.skipped);

    // Ownership guard (PLAN §15) and consolidation collisions (§12, M8).
    const ldFlag = req.ld.flags.get(r.flagKey);
    item.exists = !!ldFlag;
    let adopt = false;
    const other = shellOwner.get(r.flagKey);
    if (other && other !== gate.uid) return finishItem(item, 'error', `two StatSig sources both produce LD key “${r.flagKey}” (consolidation arrives in M8; migrate one source at a time)`);
    shellOwner.set(r.flagKey, gate.uid);
    if (ldFlag) {
      const owner = flagOwner(ldFlag);
      if (owner && (owner.id !== gate.id || owner.source !== snapshot.source.alias)) return finishItem(item, 'error', `LD flag “${r.flagKey}” was migrated from ${owner.source}/${owner.id}; consolidation arrives in M8`);
      if (ldFlag.kind && ldFlag.kind !== 'boolean') return finishItem(item, 'error', `LD flag “${r.flagKey}” exists and is not a boolean flag`);
      if (!owner) {
        const c = collision(item, { sourceId: gate.source.sourceId, kind: 'gate', uid: gate.uid, id: gate.id }, r.flagKey, 'flag', 'flag key');
        if (c === 'skip') return finishItem(item, 'skipped', `LD flag “${r.flagKey}” exists and was not adopted`);
        if (c === 'open') return finishItem(item, 'blocked', `LD flag “${r.flagKey}” already exists`);
        adopt = true;
      }
    }

    // Dependencies in the same environment.
    const depSteps: string[] = ensureKinds(r.dependencies);
    const depProblems: string[] = [];
    for (const d of r.dependencies) {
      if (d.kind === 'segment') {
        const s = planSegment(snapshot, d.entityId ?? d.key, statsigEnv, ldEnv, gate.uid);
        if (s.ok && s.stepId) depSteps.push(s.stepId);
        else depProblems.push(s.reason ?? `segment ${d.key}`);
      } else if (d.kind === 'flag') {
        const ref = snapshot.gates.find((g) => g.id === d.entityId);
        if (!ref) {
          depProblems.push(`prerequisite gate “${d.entityId}” not found`);
          continue;
        }
        const p = planGate(ref, ldEnv, gate.uid, [...stack, gate.uid]);
        if (p.ok && p.stepId) depSteps.push(p.stepId);
        else depProblems.push(`prerequisite ${p.reason ?? d.key}`);
      }
    }

    if (r.unresolved.length) return finishItem(item, 'blocked', `${r.unresolved.length} open decision${r.unresolved.length === 1 ? '' : 's'}`);
    if (depProblems.length) return finishItem(item, 'blocked', `depends on: ${depProblems.join('; ')}`);

    const shellId = `shell:${r.flagKey}`;
    if (!steps.has(shellId)) steps.set(shellId, { id: shellId, deps: [], op: 'upsert_flag_shell', key: r.flagKey, exists: !!ldFlag, adopt, desired: r.shell });
    const stepId = `env:${ldEnv}:${r.flagKey}`;
    steps.set(stepId, {
      id: stepId,
      deps: [shellId, ...depSteps],
      op: 'update_flag_env',
      key: r.flagKey,
      ldEnv,
      statsigEnv,
      variations: r.shell.variations.map((v) => v.value),
      desired: r.env,
      provenance: { sourceAlias: snapshot.source.alias, statsigType: 'gate', statsigId: gate.id, ...(gate.version !== undefined ? { statsigVersion: gate.version } : {}), statsigFingerprint: r.statsigFingerprint, decisionSetHash: r.decisionSetHash },
    });
    return { ok: true, stepId };
  };

  for (const ldEnv of req.ldEnvs) {
    for (const uid of req.gates) {
      const gate = gatesByUid.get(uid);
      if (!gate) {
        errors.push(`Gate ${uid} is not in the current snapshots.`);
        continue;
      }
      planGate(gate, ldEnv, null, []);
    }
  }

  // A step whose dependency was dropped (blocked item) can't run either.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, s] of steps) {
      if (s.deps.some((d) => !steps.has(d))) {
        steps.delete(id);
        changed = true;
      }
    }
  }
  // Drop dependencies nothing needs any more: shells whose environment steps were removed, and
  // segments / context kinds whose only dependents are blocked (they'd be written for nothing).
  changed = true;
  while (changed) {
    changed = false;
    for (const [id, s] of steps) {
      if (s.op === 'update_flag_env' || [...steps.values()].some((x) => x.deps.includes(id))) continue;
      steps.delete(id);
      changed = true;
    }
  }

  const ordered = topoSort([...steps.values()], errors);
  const all = [...items.values()];
  const requested = all.filter((i) => !i.dependency);
  return {
    items: all,
    steps: ordered,
    decisions: [...decisions.values()],
    stale: [...stale.values()],
    errors,
    confirmEnvs: req.ldEnvs.filter((e) => req.ld.criticalEnvs.includes(e) && ordered.some((s) => 'ldEnv' in s && s.ldEnv === e)),
    ready: errors.length === 0 && requested.every((i) => i.status === 'ready' || i.status === 'skipped') && all.every((i) => i.status !== 'blocked' && i.status !== 'error'),
    requests: ordered.reduce((n, s) => n + REQUESTS[s.op], 0),
  };
}

/** Writes per step, including the reads that capture pre-images. */
const REQUESTS: Record<PlanStep['op'], number> = { ensure_context_kind: 1, upsert_segment: 3, upsert_flag_shell: 2, update_flag_env: 2 };

/** Kahn's algorithm, stable by step id. Steps in a cycle are reported and left out. */
export function topoSort(steps: PlanStep[], errors: string[]): PlanStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const indegree = new Map(steps.map((s) => [s.id, s.deps.filter((d) => byId.has(d)).length]));
  const order = (id: string) => `${['context_kind', 'segment', 'shell', 'env'].indexOf(id.split(':')[0]!)}:${id}`;
  const queue = steps.filter((s) => indegree.get(s.id) === 0).map((s) => s.id).sort((a, b) => order(a).localeCompare(order(b)));
  const out: PlanStep[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(byId.get(id)!);
    const freed: string[] = [];
    for (const s of steps) {
      if (!s.deps.includes(id)) continue;
      const n = indegree.get(s.id)! - 1;
      indegree.set(s.id, n);
      if (n === 0) freed.push(s.id);
    }
    queue.push(...freed);
    queue.sort((a, b) => order(a).localeCompare(order(b)));
  }
  if (out.length < steps.length) {
    const stuck = steps.filter((s) => !out.includes(s)).map((s) => s.id);
    errors.push(`Dependency cycle between: ${stuck.join(', ')}.`);
  }
  return out;
}

export function flagOwner(f: LdFlagState): { id: string; source: string } | null {
  if (!f.tags.includes(TAG_MIGRATED)) return null;
  const id = f.customProperties['statsig.id']?.value?.[0];
  const source = f.customProperties['statsig.source']?.value?.[0];
  return id && source ? { id, source } : null;
}

export function ownsSegment(s: LdSegmentState, alias: string): boolean {
  return s.tags.includes(TAG_MIGRATED) && s.tags.includes(sourceTag(alias));
}

export type MigrationStatus = 'not_in_ld' | 'not_migrated' | 'in_sync' | 'statsig_changed' | 'decisions_changed' | 'foreign' | 'other_source';

/**
 * Per-(flag, environment) status from LD provenance alone (PLAN §3.3, §14), so it's right on any
 * machine: compares the fingerprint recorded at sync with the current one. `expected` is the
 * StatSig entity asking; a flag migrated from another source or entity is `other_source`.
 */
export function migrationStatus(
  ldFlag: LdFlagState | undefined,
  ldEnv: string,
  current: { statsigFingerprint: string; decisionSetHash: string },
  expected?: { id: string; source: string },
): { status: MigrationStatus; syncedAt?: string } {
  if (!ldFlag) return { status: 'not_in_ld' };
  const owner = flagOwner(ldFlag);
  if (!owner) return { status: 'foreign' };
  if (expected && (owner.id !== expected.id || owner.source !== expected.source)) return { status: 'other_source' };
  const sync = ldFlag.customProperties[syncPropertyKey(ldEnv)]?.value;
  if (!sync?.length) return { status: 'not_migrated' };
  const [fp, , syncedAt, dsh] = sync;
  const base = syncedAt ? { syncedAt } : {};
  if (fp !== current.statsigFingerprint) return { status: 'statsig_changed', ...base };
  if (dsh !== current.decisionSetHash) return { status: 'decisions_changed', ...base };
  return { status: 'in_sync', ...base };
}
