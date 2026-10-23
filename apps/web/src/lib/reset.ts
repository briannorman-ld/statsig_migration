/**
 * "Make the LD project look like day 0." A deliberately destructive, user-triggered operation,
 * reachable only behind three typed confirmations (screens/ProjectResetModal.tsx). It removes
 * everything a project accumulates: flags (all environments), segments, metrics, experiments
 * (archived: LD can't delete them), custom context kinds (archived: same) and the environments
 * this app created (tagged `statsig-migrated`; LD's own default environments stay, a project
 * needs at least one). Nothing in StatSig is touched, ever.
 */
import { LdWriteError, TAG_MIGRATED_ENV, type LdClient } from '@sslm/ld-client';
import { ldClient, refreshLdState, reprobe, type LdSession } from './ld.ts';

/** Thrown out of the step in flight when the user cancels; `resetProject` turns it into `report.cancelled`. */
class ResetCancelled extends Error {
  constructor() {
    super('Reset cancelled.');
    this.name = 'ResetCancelled';
  }
}

export interface ResetProgress {
  phase: string;
  done: number;
  total: number;
  message?: string;
}

export interface ResetReport {
  deleted: Record<'flags' | 'segments' | 'metrics' | 'environments', number>;
  archived: Record<'experiments' | 'contextKinds', number>;
  /** What LD refused, with the reason. The project may still hold these. */
  failures: { what: string; reason: string }[];
  /** The user cancelled: the counts above are what was removed before the stop; the rest is still there. */
  cancelled?: boolean;
}

type Client = Pick<
  LdClient,
  | 'listFlags'
  | 'deleteFlag'
  | 'listEnvironments'
  | 'listSegments'
  | 'deleteSegment'
  | 'listMetrics'
  | 'deleteMetric'
  | 'listExperiments'
  | 'patchExperimentSemantic'
  | 'listContextKinds'
  | 'putContextKind'
  | 'deleteEnvironment'
>;

/**
 * Reset the workspace's LD project. Aborting `signal` stops after the request in flight; the
 * report then says what was removed before the stop (`cancelled: true`) and the LD state is
 * re-read either way, so the UI shows what is actually left.
 */
export async function resetLdProject(workspaceId: string, ld: LdSession, onProgress?: (p: ResetProgress) => void, signal?: AbortSignal): Promise<ResetReport> {
  if (!ld.projectKey) throw new Error('Choose an LD project first.');
  const report = await resetProject(ldClient(workspaceId), ld.projectKey, onProgress, signal);
  // The environment list may have changed: re-probe, then re-read flags and segments.
  await reprobe(workspaceId);
  await refreshLdState(workspaceId);
  return report;
}

/** The reset itself, against any client (tests pass a fake). */
export async function resetProject(c: Client, projectKey: string, onProgress?: (p: ResetProgress) => void, signal?: AbortSignal): Promise<ResetReport> {
  const report: ResetReport = { deleted: { flags: 0, segments: 0, metrics: 0, environments: 0 }, archived: { experiments: 0, contextKinds: 0 }, failures: [] };
  try {
    await resetSteps(c, projectKey, report, onProgress, signal);
  } catch (e) {
    if (!(e instanceof ResetCancelled)) throw e;
    report.cancelled = true;
    onProgress?.({ phase: 'Cancelled', done: 1, total: 1 });
  }
  return report;
}

async function resetSteps(c: Client, projectKey: string, report: ResetReport, onProgress: ((p: ResetProgress) => void) | undefined, signal: AbortSignal | undefined): Promise<void> {
  const envs = await c.listEnvironments(projectKey, signal);
  // Checked before every request: a cancel never starts another delete.
  const progress = (phase: string, done: number, total: number, message?: string) => {
    if (signal?.aborted) throw new ResetCancelled();
    onProgress?.({ phase, done, total, ...(message ? { message } : {}) });
  };
  const attempt = async (what: string, fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch (e) {
      if (signal?.aborted) throw new ResetCancelled();
      if (e instanceof LdWriteError && e.status === 404) return true;
      report.failures.push({ what, reason: (e as Error).message });
      return false;
    }
  };

  // 1. Experiments first: a flag with a running experiment can't be deleted.
  for (const env of envs) {
    const experiments = await optional(() => c.listExperiments(projectKey, env.key, signal), signal);
    const live = experiments.filter((x) => x.archivedDate == null);
    for (const [i, x] of live.entries()) {
      progress('Archiving experiments', i, live.length, `${env.key}/${x.key}`);
      const status = x.currentIteration?.status;
      if (status === 'running') await attempt(`stop experiment ${env.key}/${x.key}`, () => c.patchExperimentSemantic(projectKey, env.key, x.key, { instructions: [{ kind: 'stopIteration', winningTreatmentId: x.currentIteration?.treatments?.[0]?._id, winningReason: 'Project reset' }] }, signal));
      if (await attempt(`archive experiment ${env.key}/${x.key}`, () => c.patchExperimentSemantic(projectKey, env.key, x.key, { instructions: [{ kind: 'archiveExperiment' }] }, signal))) report.archived.experiments++;
    }
  }

  // 2. Flags, in passes: a flag used as a prerequisite can't go before its dependents.
  let flags = (await c.listFlags(projectKey, { signal })).map((f) => f.key);
  const total = flags.length;
  for (let pass = 0; pass < 5 && flags.length; pass++) {
    const remaining: string[] = [];
    for (const key of flags) {
      progress('Deleting flags', total - flags.length + remaining.length, total, key);
      try {
        await c.deleteFlag(projectKey, key, signal);
        report.deleted.flags++;
      } catch (e) {
        if (signal?.aborted) throw new ResetCancelled();
        if (e instanceof LdWriteError && e.status === 404) continue;
        if (pass === 4) report.failures.push({ what: `delete flag ${key}`, reason: (e as Error).message });
        else remaining.push(key);
      }
    }
    flags = remaining;
  }

  // 3. Segments, per environment (flags referencing them are gone).
  for (const env of envs) {
    progress('Deleting segments', 0, 0, env.key);
    const segments = await c.listSegments(projectKey, env.key, signal);
    for (const [i, s] of segments.entries()) {
      progress('Deleting segments', i, segments.length, `${env.key}/${s.key}`);
      if (await attempt(`delete segment ${env.key}/${s.key}`, () => c.deleteSegment(projectKey, env.key, s.key, signal))) report.deleted.segments++;
    }
  }

  // 4. Metrics (experiments that used them are archived).
  const metrics = await optional(() => c.listMetrics(projectKey, signal), signal);
  for (const [i, m] of metrics.entries()) {
    progress('Deleting metrics', i, metrics.length, m.key);
    if (await attempt(`delete metric ${m.key}`, () => c.deleteMetric(projectKey, m.key, signal))) report.deleted.metrics++;
  }

  // 5. Custom context kinds: archived (LD has no delete).
  progress('Archiving context kinds', 0, 0);
  const kinds = (await c.listContextKinds(projectKey, signal)).items.filter((k) => k.key !== 'user' && !k.archived);
  for (const [i, k] of kinds.entries()) {
    progress('Archiving context kinds', i, kinds.length, k.key);
    if (await attempt(`archive context kind ${k.key}`, () => c.putContextKind(projectKey, k.key, { name: k.name ?? k.key, archived: true }, signal))) report.archived.contextKinds++;
  }

  // 6. Environments this app created. Never the last one, and never ones we didn't create.
  const ours = envs.filter((e) => (e.tags ?? []).includes(TAG_MIGRATED_ENV));
  for (const [i, e] of ours.entries()) {
    if (envs.length - report.deleted.environments <= 1) break;
    progress('Deleting environments', i, ours.length, e.key);
    if (await attempt(`delete environment ${e.key}`, () => c.deleteEnvironment(projectKey, e.key, signal))) report.deleted.environments++;
  }

  progress('Done', 1, 1);
}

/** Experimentation reads 403 on plans without the add-on: treat as "nothing there". A cancel still cancels. */
async function optional<T>(fn: () => Promise<T[]>, signal?: AbortSignal): Promise<T[]> {
  try {
    return await fn();
  } catch {
    if (signal?.aborted) throw new ResetCancelled();
    return [];
  }
}
