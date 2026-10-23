/**
 * In-tab executor (PLAN §9 steps 4–7, §15). Runs a plan's steps against LD in order:
 * - every step is journaled before and after it runs, so a closed tab resumes where it stopped;
 * - every write is idempotent (a create that already happened is recognized by its provenance);
 * - the state of anything updated is captured first (pre-image), so the run can be undone;
 * - each flag environment is one atomic semantic PATCH that also records provenance.
 */
import { LdAuthError, LdWriteError, type JsonPatchOp, type LdClient, type LdExperiment, type LdExperimentationSettings, type LdFlag, type LdFlagConfig, type LdMetric, type LdSegment, type SemanticPatch } from '@sslm/ld-client';
import { flagOwner, ownsSegment, syncPropertyKey, type PlanStep } from '@sslm/planner';
import type { DesiredBandit, DesiredRule, VariationOrRollout } from '@sslm/mapper';

export type LdWriter = Pick<
  LdClient,
  | 'getFlag'
  | 'createFlag'
  | 'patchFlagSemantic'
  | 'patchFlagJson'
  | 'deleteFlag'
  | 'getSegment'
  | 'createSegment'
  | 'patchSegmentJson'
  | 'deleteSegment'
  | 'putContextKind'
  | 'getMetric'
  | 'createMetric'
  | 'patchMetricJson'
  | 'deleteMetric'
  | 'getExperiment'
  | 'createExperiment'
  | 'createIteration'
  | 'patchExperimentSemantic'
  | 'getExperimentationSettings'
  | 'putExperimentationSettings'
>;

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'undone';
export type RunStatus = 'running' | 'done' | 'failed' | 'stopped' | 'undoing' | 'undone' | 'undo_failed';

export interface StepRecord {
  id: string;
  label: string;
  status: StepStatus;
  step: PlanStep;
  startedAt?: string;
  finishedAt?: string;
  /** Plain-language outcome, e.g. "Created flag", "Would update 3 rules". */
  message?: string;
  error?: string;
  /** The environment needs an approval request (HTTP 405); fallback arrives in M4. */
  approvalRequired?: boolean;
  /** Created by this run: undo deletes (or archives) it. */
  created?: boolean;
  /** State before this run touched it: undo restores it. Contains customer config; stays local. */
  preImage?: LdFlag | LdSegment | LdMetric | LdExperiment | LdExperimentationSettings;
  ldVersion?: number;
}

export interface RunRecord {
  id: string;
  workspaceId: string;
  projectKey: string;
  label: string;
  dryRun: boolean;
  actor?: string;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  steps: StepRecord[];
  undoneAt?: string;
}

export interface Journal {
  save(run: RunRecord): Promise<void>;
}

export interface ExecutorOptions {
  client: LdWriter;
  projectKey: string;
  journal: Journal;
  /** Shown in LD audit-log comments, e.g. the member email from caller identity. */
  actor?: string;
  onProgress?: (run: RunRecord) => void;
  now?: () => Date;
}

/** Systemic failures stop the whole run instead of failing every remaining step (PLAN §9 step 6). */
function isSystemic(e: unknown): boolean {
  return e instanceof LdAuthError || (e instanceof LdWriteError && (e.status === 403 || e.status === 'unreachable'));
}

export function stepLabel(s: PlanStep): string {
  switch (s.op) {
    case 'ensure_context_kind':
      return `Context kind “${s.key}”`;
    case 'upsert_segment':
      return `Segment “${s.key}” in ${s.ldEnv}`;
    case 'upsert_flag_shell':
      return `Flag “${s.key}” (project settings)`;
    case 'update_flag_env':
      return `Flag “${s.key}” targeting in ${s.ldEnv}`;
    case 'ensure_randomization_unit':
      return `Randomization unit “${s.key}” (experimentation settings)`;
    case 'upsert_metric':
      return `Metric “${s.key}” (project)`;
    case 'create_bandit':
      return `Bandit “${s.key}” in ${s.ldEnv} (draft)`;
  }
}

export function newRun(input: { id: string; workspaceId: string; projectKey: string; label: string; dryRun: boolean; actor?: string; steps: PlanStep[]; now: Date }): RunRecord {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    projectKey: input.projectKey,
    label: input.label,
    dryRun: input.dryRun,
    ...(input.actor ? { actor: input.actor } : {}),
    startedAt: input.now.toISOString(),
    status: 'running',
    steps: input.steps.map((step) => ({ id: step.id, label: stepLabel(step), status: 'pending', step })),
  };
}

export class Executor {
  private readonly c: LdWriter;
  private readonly p: string;
  private readonly now: () => Date;
  /** Flags read during this run, by key (variation IDs for prerequisites). */
  private readonly flags = new Map<string, LdFlag>();

  constructor(private readonly opts: ExecutorOptions) {
    this.c = opts.client;
    this.p = opts.projectKey;
    this.now = opts.now ?? (() => new Date());
  }

  /** Runs (or resumes) every pending step. A dry run writes nothing (LD `dryRun=true`). */
  async run(run: RunRecord, signal?: AbortSignal): Promise<RunRecord> {
    run.status = 'running';
    await this.save(run);
    const failed = new Set<string>();
    for (const rec of run.steps) {
      if (rec.status === 'done' || rec.status === 'skipped') continue;
      if (signal?.aborted) {
        run.status = 'stopped';
        break;
      }
      const blockedBy = rec.step.deps.find((d) => failed.has(d));
      if (blockedBy) {
        rec.status = 'skipped';
        rec.message = `Skipped: depends on ${run.steps.find((s) => s.id === blockedBy)?.label ?? blockedBy}, which failed.`;
        failed.add(rec.id);
        await this.save(run);
        continue;
      }
      rec.status = 'running';
      rec.startedAt = this.now().toISOString();
      delete rec.error;
      await this.save(run);
      try {
        rec.message = await this.execute(run, rec);
        rec.status = 'done';
      } catch (e) {
        rec.status = 'failed';
        rec.error = (e as Error).message;
        if (e instanceof LdWriteError && e.status === 405) rec.approvalRequired = true;
        failed.add(rec.id);
        if (isSystemic(e)) {
          rec.finishedAt = this.now().toISOString();
          run.status = 'stopped';
          await this.save(run);
          break;
        }
      }
      rec.finishedAt = this.now().toISOString();
      await this.save(run);
    }
    if (run.status === 'running') run.status = run.steps.some((s) => s.status === 'failed') ? 'failed' : 'done';
    run.finishedAt = this.now().toISOString();
    await this.save(run);
    return run;
  }

  /** Undo a run: restore pre-images and delete what it created, newest first (PLAN §15). */
  async undo(run: RunRecord): Promise<RunRecord> {
    if (run.dryRun) throw new Error('A dry run wrote nothing; there is nothing to undo.');
    run.status = 'undoing';
    await this.save(run);
    const createdFlags = new Set(run.steps.filter((s) => s.step.op === 'upsert_flag_shell' && s.created).map((s) => s.step.key));
    let ok = true;
    for (const rec of [...run.steps].reverse()) {
      if (rec.status !== 'done' && !(rec.status === 'failed' && rec.created)) continue;
      try {
        await this.revert(run, rec, createdFlags);
        rec.status = 'undone';
        rec.message = `Undone: ${rec.message ?? ''}`.trim();
      } catch (e) {
        ok = false;
        rec.error = `Undo failed: ${(e as Error).message}`;
        if (isSystemic(e)) break;
      }
      await this.save(run);
    }
    run.status = ok ? 'undone' : 'undo_failed';
    run.undoneAt = this.now().toISOString();
    await this.save(run);
    return run;
  }

  private async save(run: RunRecord) {
    await this.opts.journal.save(run);
    this.opts.onProgress?.(structuredClone(run));
  }

  private comment(run: RunRecord, s: PlanStep): string {
    const by = this.opts.actor ? ` by ${this.opts.actor}` : '';
    const ref = `run #${run.id.slice(0, 8)}`;
    if (s.op === 'update_flag_env' || s.op === 'upsert_segment' || s.op === 'upsert_metric' || s.op === 'create_bandit') {
      const p = s.provenance;
      return `Synced from StatSig ${p.statsigType} ${p.statsigId}${p.statsigVersion !== undefined ? ` v${p.statsigVersion}` : ''} (source ${p.sourceAlias})${by}, ${ref}`;
    }
    return `StatSig migration${by}, ${ref}`;
  }

  // ---------------------------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------------------------

  private execute(run: RunRecord, rec: StepRecord): Promise<string> {
    const s = rec.step;
    switch (s.op) {
      case 'ensure_context_kind':
        return this.contextKind(run, rec, s);
      case 'upsert_segment':
        return this.segment(run, rec, s);
      case 'upsert_flag_shell':
        return this.shell(run, rec, s);
      case 'update_flag_env':
        return this.flagEnv(run, rec, s);
      case 'ensure_randomization_unit':
        return this.randomizationUnit(run, rec, s);
      case 'upsert_metric':
        return this.metric(run, rec, s);
      case 'create_bandit':
        return this.bandit(run, rec, s);
    }
  }

  private async randomizationUnit(run: RunRecord, rec: StepRecord, s: Extract<PlanStep, { op: 'ensure_randomization_unit' }>): Promise<string> {
    const settings = await this.c.getExperimentationSettings(this.p);
    const units = settings.randomizationUnits ?? [];
    if (units.some((u) => u.randomizationUnit === s.key)) return `Randomization unit “${s.key}” already enabled.`;
    if (run.dryRun) return `Would enable “${s.key}” as a randomization unit.`;
    if (rec.preImage === undefined) rec.preImage = settings;
    await this.c.putExperimentationSettings(this.p, { randomizationUnits: [...units.map((u) => ({ randomizationUnit: u.randomizationUnit, ...(u.default ? { default: true } : {}) })), { randomizationUnit: s.key }] });
    rec.created = true;
    return `Enabled “${s.key}” as a randomization unit.`;
  }

  private async metric(run: RunRecord, rec: StepRecord, s: Extract<PlanStep, { op: 'upsert_metric' }>): Promise<string> {
    const d = s.desired;
    let current = await this.c.getMetric(this.p, s.key);
    if (current && !rec.created && rec.preImage === undefined) {
      const same = current.kind === 'custom' && current.eventKey === d.eventKey;
      if (!s.adopt && !same && !ownsSegment({ tags: current.tags ?? [] }, s.provenance.sourceAlias)) throw new Error(`Metric “${s.key}” appeared since planning and wasn't created by this app. Re-plan to decide.`);
      rec.preImage = current;
    }
    if (!current) {
      if (run.dryRun) return `Would create custom metric “${s.key}” on event “${d.eventKey}”.`;
      const body = { key: d.key, name: d.name, description: d.description, kind: d.kind, eventKey: d.eventKey, isNumeric: d.isNumeric, successCriteria: d.successCriteria, tags: d.tags, analysisUnits: d.analysisUnits };
      try {
        current = await this.c.createMetric(this.p, body);
      } catch (e) {
        if (!(e instanceof LdWriteError && e.status === 409)) throw e;
        current = await this.c.getMetric(this.p, s.key);
        if (!current || !ownsSegment({ tags: current.tags ?? [] }, s.provenance.sourceAlias)) throw e;
      }
      rec.created = true;
      return `Created metric “${s.key}” on event “${d.eventKey}”.`;
    }
    // Same event under the same key: the metric already is what the bandit needs. Only tag it.
    const ops: JsonPatchOp[] = [];
    const tags = union(current.tags ?? [], d.tags);
    if (tags.length !== (current.tags ?? []).length) ops.push({ op: 'replace', path: '/tags', value: tags });
    if (current.eventKey !== d.eventKey) ops.push({ op: 'replace', path: '/eventKey', value: d.eventKey });
    if (ops.length === 0) return `Metric “${s.key}” already up to date.`;
    if (run.dryRun) return `Would update metric “${s.key}” (${ops.map((o) => o.path.slice(1)).join(', ')}).`;
    await this.c.patchMetricJson(this.p, s.key, ops, { comment: this.comment(run, s) });
    return `Updated metric “${s.key}” (${ops.map((o) => o.path.slice(1)).join(', ')}).`;
  }

  private async bandit(run: RunRecord, rec: StepRecord, s: Extract<PlanStep, { op: 'create_bandit' }>): Promise<string> {
    const d = s.desired;
    const flag = this.flags.get(s.flagKey) ?? (await this.c.getFlag(this.p, s.flagKey));
    if (!flag) {
      if (run.dryRun) return `Would create bandit “${s.key}” in ${s.ldEnv}: ${banditSummary(d)}.`;
      throw new Error(`Flag “${s.flagKey}” doesn't exist (its settings step didn't run).`);
    }
    const env = flag.environments?.[s.ldEnv];
    const iteration = banditIteration(d, flag, env?.version ?? 0);
    let current = await this.c.getExperiment(this.p, s.ldEnv, s.key);
    if (current && !rec.created && rec.preImage === undefined) {
      if (!s.adopt && !ownsSegment({ tags: current.tags ?? [] }, s.provenance.sourceAlias)) throw new Error(`Experiment “${s.key}” appeared in ${s.ldEnv} since planning and wasn't created by this app. Re-plan to decide.`);
      rec.preImage = current;
    }
    if (!current) {
      if (run.dryRun) return `Would create bandit “${s.key}” in ${s.ldEnv}: ${banditSummary(d)}.`;
      const body = { key: d.key, name: d.name, description: withFooter(d.description, footer(s.provenance, this.now())), type: 'mab', tags: d.tags, iteration };
      try {
        current = await this.c.createExperiment(this.p, s.ldEnv, body);
      } catch (e) {
        if (!(e instanceof LdWriteError && e.status === 409)) throw e;
        current = await this.c.getExperiment(this.p, s.ldEnv, s.key);
        if (!current || !ownsSegment({ tags: current.tags ?? [] }, s.provenance.sourceAlias)) throw e;
      }
      rec.created = true;
      return `Created bandit “${s.key}” in ${s.ldEnv} as a draft: ${banditSummary(d)}.`;
    }
    // An iteration that ran (or runs) is the customer's experiment history: never replaced.
    const status = current.draftIteration?.status ?? current.currentIteration?.status;
    if (status && status !== 'not_started') return `Bandit “${s.key}” in ${s.ldEnv} has ${status === 'running' ? 'a running' : 'a finished'} iteration; left as is.`;
    if (run.dryRun) return `Would replace the draft of bandit “${s.key}” in ${s.ldEnv}: ${banditSummary(d)}.`;
    await this.c.createIteration(this.p, s.ldEnv, s.key, iteration);
    return `Replaced the draft of bandit “${s.key}” in ${s.ldEnv}: ${banditSummary(d)}.`;
  }

  private async contextKind(run: RunRecord, rec: StepRecord, s: Extract<PlanStep, { op: 'ensure_context_kind' }>): Promise<string> {
    if (run.dryRun) return `Would create context kind “${s.key}”.`;
    await this.c.putContextKind(this.p, s.key, { name: s.name, description: `StatSig unit type ${s.unitType} (created by the StatSig migration).` });
    rec.created = true;
    return `Created context kind “${s.key}”.`;
  }

  private async segment(run: RunRecord, rec: StepRecord, s: Extract<PlanStep, { op: 'upsert_segment' }>): Promise<string> {
    const d = s.desired;
    let current = await this.c.getSegment(this.p, s.ldEnv, s.key);
    if (current && !rec.created && rec.preImage === undefined) {
      // Re-check ownership: the LD project may have changed since planning.
      if (!s.adopt && !ownsSegment({ key: current.key, tags: current.tags ?? [] }, s.provenance.sourceAlias)) throw new Error(`Segment “${s.key}” appeared in ${s.ldEnv} since planning and wasn't created by this app. Re-plan to decide.`);
      if (!rec.created) rec.preImage = current;
    }
    const description = withFooter(d.description, footer(s.provenance, this.now()));
    if (!current) {
      if (run.dryRun) return `Would create segment “${s.key}” in ${s.ldEnv} with ${segmentSummary(d)}.`;
      try {
        current = await this.c.createSegment(this.p, s.ldEnv, { key: s.key, name: d.name, description, tags: d.tags });
      } catch (e) {
        if (!(e instanceof LdWriteError && e.status === 409)) throw e;
        current = await this.c.getSegment(this.p, s.ldEnv, s.key);
        if (!current || !ownsSegment({ key: current.key, tags: current.tags ?? [] }, s.provenance.sourceAlias)) throw e;
      }
      rec.created = true;
    }
    const patch: JsonPatchOp[] = [
      { op: 'add', path: '/rules', value: d.rules.map((r) => ({ description: r.description, clauses: r.clauses, ...(r.weight !== undefined ? { weight: r.weight, rolloutContextKind: r.rolloutContextKind } : {}) })) },
      { op: 'add', path: '/included', value: d.included },
      { op: 'add', path: '/includedContexts', value: d.includedContexts },
      { op: 'add', path: '/description', value: description },
      { op: 'add', path: '/tags', value: union(current.tags ?? [], d.tags) },
    ];
    const res = await this.c.patchSegmentJson(this.p, s.ldEnv, s.key, patch, { comment: this.comment(run, s), dryRun: run.dryRun });
    rec.ldVersion = res.version ?? undefined;
    if (run.dryRun) return `Would update segment “${s.key}” in ${s.ldEnv}: ${segmentSummary(d)}.`;
    return `${rec.created ? 'Created' : 'Updated'} segment “${s.key}” in ${s.ldEnv}: ${segmentSummary(d)}.`;
  }

  private async shell(run: RunRecord, rec: StepRecord, s: Extract<PlanStep, { op: 'upsert_flag_shell' }>): Promise<string> {
    const d = s.desired;
    let flag = await this.c.getFlag(this.p, s.key);
    if (flag && !rec.created && rec.preImage === undefined) {
      const owner = flagOwner({ key: flag.key, tags: flag.tags ?? [], customProperties: flag.customProperties ?? {} });
      if (!s.adopt && !owner) throw new Error(`Flag “${s.key}” appeared since planning and wasn't created by this app. Re-plan to decide.`);
      rec.preImage = flag;
    }
    if (!flag) {
      if (run.dryRun) return d.variations.every((v) => typeof v.value === 'boolean') ? `Would create boolean flag “${s.key}” (${d.tags.join(', ')}).` : `Would create JSON flag “${s.key}” with ${d.variations.length} variations (${d.tags.join(', ')}).`;
      const body = { key: d.key, name: d.name, description: d.description, variations: d.variations, defaults: d.defaults, temporary: d.temporary, tags: d.tags, customProperties: d.customProperties, clientSideAvailability: d.clientSideAvailability };
      try {
        flag = await this.c.createFlag(this.p, body);
      } catch (e) {
        if (!(e instanceof LdWriteError && e.status === 409)) throw e;
        // A retried create after an interrupted run: it's ours if it carries our provenance.
        flag = await this.c.getFlag(this.p, s.key);
        const owner = flag && flagOwner({ key: flag.key, tags: flag.tags ?? [], customProperties: flag.customProperties ?? {} });
        if (!flag || owner?.id !== d.customProperties['statsig.id']?.value[0]) throw e;
      }
      rec.created = true;
      this.flags.set(s.key, flag);
      return `Created flag “${s.key}”.`;
    }
    const ops = shellPatch(flag, d);
    this.flags.set(s.key, flag);
    if (ops.length === 0) return `Flag “${s.key}” settings already up to date.`;
    const res = await this.c.patchFlagJson(this.p, s.key, ops, { comment: this.comment(run, s), dryRun: run.dryRun });
    if (!run.dryRun) this.flags.set(s.key, res);
    return `${run.dryRun ? 'Would update' : 'Updated'} flag “${s.key}” settings (${ops.map((o) => o.path.split('/')[1]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}).`;
  }

  private async flagEnv(run: RunRecord, rec: StepRecord, s: Extract<PlanStep, { op: 'update_flag_env' }>): Promise<string> {
    const flag = await this.c.getFlag(this.p, s.key);
    if (!flag) {
      if (run.dryRun) return `Would set targeting in ${s.ldEnv}: ${envSummary(s.desired, s.variations)}.`;
      throw new Error(`Flag “${s.key}” doesn't exist (its settings step didn't run).`);
    }
    this.flags.set(s.key, flag);
    if (rec.preImage === undefined) rec.preImage = flag;
    const ids = variationIds(flag, s.variations);
    const d = s.desired;
    const instructions: SemanticPatch['instructions'] = [
      { kind: d.on ? 'turnFlagOn' : 'turnFlagOff' },
      { kind: 'updateOffVariation', variationId: ids(d.offVariation) },
      { kind: 'updateFallthroughVariationOrRollout', ...serve(d.fallthrough, ids) },
      { kind: 'replaceRules', rules: d.rules.map((r) => rule(r, ids)) },
      { kind: 'replaceTargets', targets: d.targets.map((t) => ({ contextKind: t.contextKind, variationId: ids(t.variation), values: t.values })) },
    ];
    const prev = flag.environments?.[s.ldEnv]?.prerequisites ?? [];
    if (d.prerequisites.length || prev.length) {
      const prerequisites = [];
      for (const p of d.prerequisites) {
        const pf = this.flags.get(p.key) ?? (await this.c.getFlag(this.p, p.key));
        if (!pf) throw new Error(`Prerequisite flag “${p.key}” doesn't exist.`);
        prerequisites.push({ key: p.key, variationId: variationIds(pf, [true, false])(p.variation) });
      }
      instructions.push({ kind: 'replacePrerequisites', prerequisites });
    }
    const res = await this.c.patchFlagSemantic(this.p, s.key, { environmentKey: s.ldEnv, comment: this.comment(run, s), instructions }, { dryRun: run.dryRun });
    rec.ldVersion = res.environments?.[s.ldEnv]?.version ?? undefined;
    // Provenance, `statsig.sync.<env>` (PLAN §3.3). LD refuses custom-property instructions in a
    // patch with environment instructions, so it's a second write; it runs only after targeting
    // succeeded, so LD never claims a sync that didn't happen.
    const prop = syncPropertyKey(s.ldEnv);
    const value = [s.provenance.statsigFingerprint, String(s.provenance.statsigVersion ?? ''), this.now().toISOString(), s.provenance.decisionSetHash];
    await this.c.patchFlagJson(this.p, s.key, [{ op: 'add', path: `/customProperties/${pointer(prop)}`, value: { name: `StatSig sync (${s.ldEnv})`, value } }], { comment: this.comment(run, s), dryRun: run.dryRun });
    return `${run.dryRun ? 'Would set' : 'Set'} targeting in ${s.ldEnv}: ${envSummary(d, s.variations)}.`;
  }

  // ---------------------------------------------------------------------------------------------
  // Undo
  // ---------------------------------------------------------------------------------------------

  private async revert(run: RunRecord, rec: StepRecord, createdFlags: Set<string>): Promise<void> {
    const s = rec.step;
    const comment = `Undo of StatSig migration run #${run.id.slice(0, 8)}${this.opts.actor ? ` by ${this.opts.actor}` : ''}`;
    switch (s.op) {
      case 'ensure_context_kind':
        // Context kinds can't be deleted; archiving hides them from targeting.
        if (rec.created) await this.c.putContextKind(this.p, s.key, { name: s.name, archived: true });
        return;
      case 'upsert_segment': {
        if (rec.created) return this.c.deleteSegment(this.p, s.ldEnv, s.key);
        const pre = rec.preImage as LdSegment | undefined;
        if (!pre) return;
        await this.c.patchSegmentJson(
          this.p,
          s.ldEnv,
          s.key,
          [
            { op: 'add', path: '/rules', value: (pre.rules ?? []).map(({ _id, ...r }) => ({ ...r, clauses: r.clauses.map(({ _id: _c, ...c }) => c) })) },
            { op: 'add', path: '/included', value: pre.included ?? [] },
            { op: 'add', path: '/includedContexts', value: pre.includedContexts ?? [] },
            { op: 'add', path: '/description', value: pre.description ?? '' },
            { op: 'add', path: '/tags', value: pre.tags ?? [] },
          ],
          { comment },
        );
        return;
      }
      case 'upsert_flag_shell': {
        if (rec.created) return this.deleteCreatedFlag(s.key, createdFlags);
        const pre = rec.preImage as LdFlag | undefined;
        if (!pre) return;
        await this.c.patchFlagJson(
          this.p,
          s.key,
          [
            { op: 'replace', path: '/name', value: pre.name },
            { op: 'replace', path: '/description', value: pre.description ?? '' },
            { op: 'replace', path: '/tags', value: pre.tags ?? [] },
            { op: 'replace', path: '/temporary', value: pre.temporary ?? true },
            { op: 'replace', path: '/customProperties', value: pre.customProperties ?? {} },
            ...(pre.clientSideAvailability ? [{ op: 'replace' as const, path: '/clientSideAvailability', value: pre.clientSideAvailability }] : []),
          ],
          { comment },
        );
        return;
      }
      case 'ensure_randomization_unit': {
        const pre = rec.preImage as LdExperimentationSettings | undefined;
        if (!rec.created || !pre) return;
        await this.c.putExperimentationSettings(this.p, { randomizationUnits: (pre.randomizationUnits ?? []).map((u) => ({ randomizationUnit: u.randomizationUnit, ...(u.default ? { default: true } : {}) })) });
        return;
      }
      case 'upsert_metric': {
        if (rec.created) {
          await this.c.deleteMetric(this.p, s.key).catch((e) => {
            if (!(e instanceof LdWriteError && e.status === 404)) throw e;
          });
          return;
        }
        const pre = rec.preImage as LdMetric | undefined;
        if (!pre) return;
        await this.c.patchMetricJson(this.p, s.key, [{ op: 'replace', path: '/tags', value: pre.tags ?? [] }, ...(pre.eventKey ? [{ op: 'replace' as const, path: '/eventKey', value: pre.eventKey }] : [])], { comment });
        return;
      }
      case 'create_bandit': {
        // Experiments can't be deleted: archiving hides a draft this run created. An adopted
        // experiment keeps the replaced draft (LD has no way to restore an iteration).
        if (rec.created) await this.c.patchExperimentSemantic(this.p, s.ldEnv, s.key, { comment, instructions: [{ kind: 'archiveExperiment' }] });
        return;
      }
      case 'update_flag_env': {
        // A flag this run created is deleted at its (last) environment step: environment steps are
        // in dependency order, so reversing them deletes dependents before their prerequisites,
        // and flags before the segments they use (LD refuses both the other way round).
        if (createdFlags.has(s.key)) return this.deleteCreatedFlag(s.key, createdFlags);
        const pre = rec.preImage as LdFlag | undefined;
        const env = pre?.environments?.[s.ldEnv];
        if (!pre || !env) return;
        const current = await this.c.getFlag(this.p, s.key);
        if (!current) return;
        const prop = syncPropertyKey(s.ldEnv);
        const prereqs = [];
        for (const p of env.prerequisites ?? []) {
          const pf = await this.c.getFlag(this.p, p.key);
          const id = pf?.variations[p.variation]?._id;
          if (id) prereqs.push({ key: p.key, variationId: id });
        }
        await this.c.patchFlagSemantic(this.p, s.key, { environmentKey: s.ldEnv, comment, instructions: restoreInstructions(pre, env, current, current.environments?.[s.ldEnv], prereqs) });
        const before = pre.customProperties?.[prop];
        if (before) await this.c.patchFlagJson(this.p, s.key, [{ op: 'add', path: `/customProperties/${pointer(prop)}`, value: before }], { comment });
        else if (current.customProperties?.[prop]) await this.c.patchFlagJson(this.p, s.key, [{ op: 'remove', path: `/customProperties/${pointer(prop)}` }], { comment });
        return;
      }
    }
  }

  private readonly deleted = new Set<string>();

  private async deleteCreatedFlag(key: string, createdFlags: Set<string>): Promise<void> {
    if (!createdFlags.has(key) || this.deleted.has(key)) return;
    await this.c.deleteFlag(this.p, key).catch((e) => {
      if (!(e instanceof LdWriteError && e.status === 404)) throw e;
    });
    this.deleted.add(key);
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type Ids = (index: number) => string;

/** Maps desired variation indexes (by value) to the flag's variation IDs. */
export function variationIds(flag: LdFlag, values: unknown[]): Ids {
  return (index: number) => {
    const want = JSON.stringify(values[index]);
    const v = flag.variations.find((x) => JSON.stringify(x.value) === want);
    if (!v) throw new Error(`Flag “${flag.key}” has no variation with value ${want}.`);
    return v._id;
  };
}

function serve(v: VariationOrRollout, ids: Ids): Record<string, unknown> {
  if (v.rollout) return { rolloutContextKind: v.rollout.contextKind, rolloutWeights: Object.fromEntries(v.rollout.variations.map((w) => [ids(w.variation), w.weight])) };
  return { variationId: ids(v.variation ?? 0) };
}

function rule(r: DesiredRule, ids: Ids): Record<string, unknown> {
  return { description: r.description, clauses: r.clauses, ...serve(r, ids) };
}

/** Semantic-patch instructions that put an environment back the way a pre-image had it. */
export function restoreInstructions(pre: LdFlag, env: LdFlagConfig, current: LdFlag, currentEnv: LdFlagConfig | undefined, prerequisites: { key: string; variationId: string }[]): SemanticPatch['instructions'] {
  const byIndex = (i: number | null | undefined) => {
    const value = pre.variations[i ?? 0]?.value;
    const v = current.variations.find((x) => JSON.stringify(x.value) === JSON.stringify(value));
    if (!v) throw new Error(`Variation ${i} of “${pre.key}” no longer exists.`);
    return v._id;
  };
  const restoreServe = (v: { variation?: number | null; rollout?: { variations: { variation: number; weight: number }[]; contextKind?: string | null; bucketBy?: string | null } | null } | null | undefined) =>
    v?.rollout
      ? { rolloutWeights: Object.fromEntries(v.rollout.variations.map((w) => [byIndex(w.variation), w.weight])), ...(v.rollout.contextKind ? { rolloutContextKind: v.rollout.contextKind } : {}), ...(v.rollout.bucketBy ? { rolloutBucketBy: v.rollout.bucketBy } : {}) }
      : { variationId: byIndex(v?.variation) };
  const targets = [...(env.targets ?? []).map((t) => ({ ...t, contextKind: t.contextKind ?? 'user' })), ...(env.contextTargets ?? [])].filter((t) => t.values.length);
  const out: SemanticPatch['instructions'] = [
    { kind: env.on ? 'turnFlagOn' : 'turnFlagOff' },
    { kind: 'updateOffVariation', variationId: byIndex(env.offVariation) },
    { kind: 'updateFallthroughVariationOrRollout', ...restoreServe(env.fallthrough) },
    {
      kind: 'replaceRules',
      rules: (env.rules ?? []).map((r) => ({
        ...(r.description ? { description: r.description } : {}),
        clauses: r.clauses.map(({ _id, ...c }) => c),
        ...(r.trackEvents ? { trackEvents: r.trackEvents } : {}),
        ...restoreServe(r),
      })),
    },
    { kind: 'replaceTargets', targets: targets.map((t) => ({ contextKind: t.contextKind ?? 'user', variationId: byIndex(t.variation), values: t.values })) },
  ];
  if (prerequisites.length || currentEnv?.prerequisites?.length) out.push({ kind: 'replacePrerequisites', prerequisites });
  return out;
}

function shellPatch(flag: LdFlag, d: Extract<PlanStep, { op: 'upsert_flag_shell' }>['desired']): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [];
  if (flag.name !== d.name) ops.push({ op: 'replace', path: '/name', value: d.name });
  if ((flag.description ?? '') !== d.description) ops.push({ op: 'replace', path: '/description', value: d.description });
  const tags = union(flag.tags ?? [], d.tags);
  if (tags.length !== (flag.tags ?? []).length) ops.push({ op: 'replace', path: '/tags', value: tags });
  if ((flag.temporary ?? true) !== d.temporary) ops.push({ op: 'replace', path: '/temporary', value: d.temporary });
  const csa = flag.clientSideAvailability;
  if (!csa || !!csa.usingEnvironmentId !== d.clientSideAvailability.usingEnvironmentId || !!csa.usingMobileKey !== d.clientSideAvailability.usingMobileKey) ops.push({ op: 'replace', path: '/clientSideAvailability', value: d.clientSideAvailability });
  for (const [k, v] of Object.entries(d.customProperties)) {
    const cur = flag.customProperties?.[k];
    if (!cur || JSON.stringify(cur.value ?? []) !== JSON.stringify(v.value)) ops.push({ op: 'add', path: `/customProperties/${pointer(k)}`, value: v });
  }
  // PLAN §7: variations are append-only. New values are added at the end; nothing is removed or reordered.
  const missing = d.variations.filter((v) => !flag.variations.some((x) => JSON.stringify(x.value) === JSON.stringify(v.value)));
  if (missing.length) {
    if (flag.kind === 'boolean' || d.variations.every((v) => typeof v.value === 'boolean')) throw new Error(`Flag “${flag.key}” lacks variation${missing.length === 1 ? '' : 's'} ${missing.map((m) => JSON.stringify(m.value)).join(', ')}.`);
    for (const v of missing) ops.push({ op: 'add', path: '/variations/-', value: { value: v.value, name: v.name } });
  }
  return ops;
}

function pointer(k: string): string {
  return k.replace(/~/g, '~0').replace(/\//g, '~1');
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

const FOOTER_RE = /\n*\[statsig-migration: [^\]]*\]\s*$/;

/** Segments have no custom properties, so provenance goes in a description footer (PLAN §3.3). */
export function footer(p: { sourceAlias: string; statsigId: string; statsigFingerprint: string; decisionSetHash: string }, at: Date): string {
  return `[statsig-migration: src=${p.sourceAlias}; id=${p.statsigId}; fp=${p.statsigFingerprint}; d=${p.decisionSetHash}; at=${at.toISOString()}]`;
}

export function withFooter(description: string, f: string): string {
  const base = description.replace(FOOTER_RE, '');
  return base ? `${base}\n\n${f}` : f;
}

export function parseFooter(description: string | null | undefined): Record<string, string> | null {
  const m = /\[statsig-migration: ([^\]]*)\]\s*$/.exec(description ?? '');
  if (!m) return null;
  return Object.fromEntries(m[1]!.split(';').map((kv) => kv.trim().split('=') as [string, string]).filter((x) => x.length === 2));
}

/** `IterationInput` for a drafted bandit (reference/launchdarkly/openapi.json): treatments by variation ID, the flag's default rule. */
export function banditIteration(d: DesiredBandit, flag: LdFlag, flagConfigVersion: number): Record<string, unknown> {
  const ids = (i: number) => {
    const v = flag.variations[i];
    if (!v) throw new Error(`Flag “${flag.key}” has no variation ${i}.`);
    return v._id;
  };
  return {
    hypothesis: d.hypothesis,
    canReshuffleTraffic: true,
    metrics: [{ key: d.metricKey, isGroup: false }],
    primarySingleMetricKey: d.metricKey,
    treatments: d.treatments.map((t) => ({ name: t.name, baseline: t.baseline, allocationPercent: t.allocationPercent, parameters: [{ flagKey: d.flagKey, variationId: ids(t.variation) }] })),
    flags: { [d.flagKey]: { ruleId: d.ruleId, flagConfigVersion, notInExperimentVariationId: ids(d.treatments.find((t) => t.baseline)?.variation ?? 0) } },
    randomizationUnit: d.randomizationUnit,
    reallocationFrequencyMillis: d.reallocationFrequencyMillis,
  };
}

export function banditSummary(d: DesiredBandit): string {
  return `${d.treatments.length} arms (${d.treatments.map((t) => `${t.name} ${t.allocationPercent}%`).join(', ')}), optimizing “${d.metricKey}” by ${d.randomizationUnit}`;
}

function segmentSummary(d: { rules: unknown[]; included: string[]; includedContexts: { values: string[] }[] }): string {
  const ids = d.included.length + d.includedContexts.reduce((n, c) => n + c.values.length, 0);
  return [d.rules.length ? `${d.rules.length} rule${d.rules.length === 1 ? '' : 's'}` : '', ids ? `${ids} IDs` : ''].filter(Boolean).join(', ') || 'no members';
}

/** One line for a run log; `variations` (the flag's values) names the default when given. */
export function envSummary(d: Extract<PlanStep, { op: 'update_flag_env' }>['desired'], variations?: unknown[]): string {
  const name = (i: number | undefined) => {
    if (!variations) return i === 0 ? 'true' : 'false';
    const v = JSON.stringify(variations[i ?? 0]);
    return v.length > 40 ? `${v.slice(0, 37)}…` : v;
  };
  const ft = d.fallthrough.rollout
    ? d.fallthrough.rollout.variations.length > 2
      ? `${d.fallthrough.rollout.variations.length}-way split`
      : `${(d.fallthrough.rollout.variations[0]!.weight / 1000).toString()}% rollout`
    : name(d.fallthrough.variation);
  const targets = d.targets.reduce((n, t) => n + t.values.length, 0);
  return [
    d.on ? 'on' : 'off',
    `${d.rules.length} rule${d.rules.length === 1 ? '' : 's'}`,
    ...(targets ? [`${targets} individual target${targets === 1 ? '' : 's'}`] : []),
    ...(d.prerequisites.length ? [`prerequisite ${d.prerequisites.map((p) => p.key).join(', ')}`] : []),
    `default ${ft}`,
  ].join(', ');
}
