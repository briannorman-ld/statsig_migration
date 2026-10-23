import { describe, expect, it } from 'vitest';
import { LdAuthError, LdWriteError, type LdExperiment, type LdFlag, type LdMetric } from '@sslm/ld-client';
import type { PlanStep } from '@sslm/planner';
import { Executor, footer, newRun, parseFooter, withFooter, type LdWriter, type RunRecord } from '../src/index.ts';

/** Minimal in-memory LD: enough state for the executor's control flow, not LD's semantics. */
function fakeLd(over: Partial<Record<keyof LdWriter, (...a: never[]) => unknown>> = {}) {
  const flags = new Map<string, LdFlag>();
  const metrics = new Map<string, LdMetric>();
  const experiments = new Map<string, LdExperiment & { iteration?: unknown }>();
  const units: string[] = ['user'];
  const calls: string[] = [];
  const flag = (key: string, body: Record<string, unknown> = {}): LdFlag => ({
    key,
    name: key,
    tags: (body.tags as string[]) ?? [],
    customProperties: (body.customProperties as LdFlag['customProperties']) ?? {},
    variations: [
      { _id: `${key}-t`, value: true },
      { _id: `${key}-f`, value: false },
    ],
    environments: { test: { on: false, offVariation: 1, fallthrough: { variation: 1 }, rules: [], targets: [] } },
  });
  const base: LdWriter = {
    getFlag: async (_p, key) => (calls.push(`get ${key}`), flags.get(key) ?? null),
    createFlag: async (_p, body) => {
      calls.push(`create ${body.key}`);
      if (flags.has(body.key as string)) throw new LdWriteError(409, '/flags', { message: 'Duplicate flag key' });
      const f = flag(body.key as string, body);
      flags.set(f.key, f);
      return f;
    },
    patchFlagSemantic: async (_p, key, patch) => (calls.push(`semantic ${key} ${patch.environmentKey ?? ''}`), flags.get(key)!),
    patchFlagJson: async (_p, key, ops) => (calls.push(`json ${key} ${ops.map((o) => o.path).join(',')}`), flags.get(key)!),
    deleteFlag: async (_p, key) => void (calls.push(`delete ${key}`), flags.delete(key)),
    getSegment: async () => null,
    createSegment: async (_p, _e, b) => ({ key: b.key, name: b.name, tags: b.tags }),
    patchSegmentJson: async (_p, _e, key) => ({ key, name: key }),
    deleteSegment: async () => undefined,
    putContextKind: async () => undefined,
    getMetric: async (_p, key) => (calls.push(`get metric ${key}`), metrics.get(key) ?? null),
    createMetric: async (_p, body) => {
      calls.push(`create metric ${body.key}`);
      const m = { key: body.key as string, name: body.name as string, kind: 'custom', eventKey: body.eventKey as string, tags: (body.tags as string[]) ?? [] };
      metrics.set(m.key, m);
      return m;
    },
    patchMetricJson: async (_p, key, ops) => (calls.push(`json metric ${key} ${ops.map((o) => o.path).join(',')}`), metrics.get(key)!),
    deleteMetric: async (_p, key) => void (calls.push(`delete metric ${key}`), metrics.delete(key)),
    getExperiment: async (_p, env, key) => (calls.push(`get experiment ${env}/${key}`), experiments.get(`${env}/${key}`) ?? null),
    createExperiment: async (_p, env, body) => {
      calls.push(`create experiment ${env}/${body.key}`);
      const e = { key: body.key as string, name: body.name as string, type: body.type as string, tags: (body.tags as string[]) ?? [], draftIteration: { status: 'not_started', hypothesis: '' }, iteration: body.iteration };
      experiments.set(`${env}/${e.key}`, e);
      return e;
    },
    createIteration: async (_p, env, key, body) => (calls.push(`iteration ${env}/${key}`), { ...experiments.get(`${env}/${key}`)!, iteration: body }),
    patchExperimentSemantic: async (_p, env, key, patch) => (calls.push(`semantic experiment ${env}/${key} ${patch.instructions.map((i) => i.kind).join(',')}`), experiments.get(`${env}/${key}`)!),
    getExperimentationSettings: async () => (calls.push('get settings'), { randomizationUnits: units.map((u) => ({ randomizationUnit: u })) }),
    putExperimentationSettings: async (_p, body) => {
      calls.push(`put settings ${body.randomizationUnits.map((u) => u.randomizationUnit).join(',')}`);
      units.splice(0, units.length, ...body.randomizationUnits.map((u) => u.randomizationUnit));
      return { randomizationUnits: body.randomizationUnits };
    },
  };
  return { client: { ...base, ...over } as LdWriter, flags, metrics, experiments, units, calls, flag };
}

const desiredEnv = { ldEnv: 'test', statsigEnv: 'staging', on: true, offVariation: 1, fallthrough: { variation: 0 }, rules: [], targets: [], prerequisites: [] };
const shell = (key: string): PlanStep => ({
  id: `shell:${key}`,
  deps: [],
  op: 'upsert_flag_shell',
  key,
  exists: false,
  adopt: false,
  desired: {
    key,
    name: key,
    description: '',
    variations: [
      { value: true, name: 'Pass' },
      { value: false, name: 'Fail' },
    ],
    defaults: { onVariation: 1, offVariation: 1 },
    temporary: true,
    tags: ['statsig-migrated', 'statsig-src-web'],
    clientSideAvailability: { usingEnvironmentId: true, usingMobileKey: true },
    customProperties: { 'statsig.id': { name: 'StatSig ID', value: [key] }, 'statsig.source': { name: 'StatSig source', value: ['web'] } },
  },
});
const env = (key: string, deps: string[] = [`shell:${key}`]): PlanStep => ({
  id: `env:test:${key}`,
  deps,
  op: 'update_flag_env',
  key,
  ldEnv: 'test',
  statsigEnv: 'staging',
  variations: [true, false],
  desired: desiredEnv,
  provenance: { sourceAlias: 'web', statsigType: 'gate', statsigId: key, statsigVersion: 3, statsigFingerprint: 'fp', decisionSetHash: 'dh' },
});

function setup(client: LdWriter, steps: PlanStep[]) {
  const saved: RunRecord[] = [];
  const ex = new Executor({ client, projectKey: 'p', journal: { save: async (r) => void saved.push(structuredClone(r)) }, actor: 'me@example.com', now: () => new Date('2026-10-22T00:00:00Z') });
  const run = newRun({ id: 'run-12345678', workspaceId: 'w', projectKey: 'p', label: 't', dryRun: false, steps, now: new Date('2026-10-22T00:00:00Z') });
  return { ex, run, saved };
}

describe('Executor', () => {
  it('creates, sets targeting, then records provenance in a separate patch', async () => {
    const ld = fakeLd();
    const { ex, run } = setup(ld.client, [shell('a'), env('a')]);
    const out = await ex.run(run);
    expect(out.status).toBe('done');
    expect(out.steps.map((s) => s.created ?? false)).toEqual([true, false]);
    expect(ld.calls.filter((c) => !c.startsWith('get'))).toEqual(['create a', 'semantic a test', 'json a /customProperties/statsig.sync.test']);
  });

  it('journals every step before and after it runs', async () => {
    const { ex, run, saved } = setup(fakeLd().client, [shell('a'), env('a')]);
    await ex.run(run);
    expect(saved.map((r) => r.steps.map((s) => s.status[0]).join(''))).toEqual(['pp', 'rp', 'dp', 'dr', 'dd', 'dd']);
  });

  it('skips steps whose dependency failed, and keeps going with independent ones', async () => {
    const ld = fakeLd({ patchFlagSemantic: async (_p: string, key: string) => (key === 'a' ? Promise.reject(new LdWriteError(400, '/flags/p/a', { message: 'bad clause' })) : ({} as LdFlag)) });
    const { ex, run } = setup(ld.client, [shell('a'), shell('b'), env('a'), env('b', ['shell:b', 'env:test:a']), env('c', [])]);
    ld.flags.set('c', ld.flag('c'));
    const out = await ex.run(run);
    expect(out.status).toBe('failed');
    expect(out.steps.map((s) => [s.id, s.status])).toEqual([
      ['shell:a', 'done'],
      ['shell:b', 'done'],
      ['env:test:a', 'failed'],
      ['env:test:b', 'skipped'],
      ['env:test:c', 'done'],
    ]);
    expect(out.steps[2]!.error).toMatch(/bad clause/);
  });

  it('stops the whole run on a 429 that outlived the retries, instead of throttling step after step', async () => {
    const ld = fakeLd({ createFlag: async () => Promise.reject(new LdWriteError(429, '/flags/p', { message: 'Rate limit exceeded' })) });
    const { ex, run } = setup(ld.client, [shell('a'), shell('b')]);
    const out = await ex.run(run);
    expect(out.status).toBe('stopped');
    expect(out.steps.map((s) => s.status)).toEqual(['failed', 'pending']);
  });

  it('stops the whole run on a 401', async () => {
    const ld = fakeLd({ createFlag: async () => Promise.reject(new LdAuthError(401, '/flags/p')) });
    const { ex, run } = setup(ld.client, [shell('a'), shell('b')]);
    const out = await ex.run(run);
    expect(out.status).toBe('stopped');
    expect(out.steps.map((s) => s.status)).toEqual(['failed', 'pending']);
  });

  it('marks 405s as needing approval', async () => {
    const ld = fakeLd({ patchFlagSemantic: async () => Promise.reject(new LdWriteError(405, '/flags/p/a', null)) });
    const { ex, run } = setup(ld.client, [shell('a'), env('a')]);
    const out = await ex.run(run);
    expect(out.steps[1]).toMatchObject({ status: 'failed', approvalRequired: true });
  });

  it('resumes an interrupted run, recognizing a create that already happened by its provenance', async () => {
    const ld = fakeLd();
    const { ex, run } = setup(ld.client, [shell('a'), env('a')]);
    // The tab closed after LD created the flag but before the journal recorded it.
    await ld.client.createFlag('p', { ...(shell('a') as Extract<PlanStep, { op: 'upsert_flag_shell' }>).desired });
    run.steps[0]!.status = 'running';
    const getFlag = ld.client.getFlag;
    let first = true;
    ld.client.getFlag = async (p, k) => (first && k === 'a' ? ((first = false), null) : getFlag(p, k));
    const out = await ex.run(run);
    expect(out.status).toBe('done');
    expect(out.steps[0]!.created).toBe(true);
  });

  it('refuses to adopt a flag that appeared since planning', async () => {
    const ld = fakeLd();
    ld.flags.set('a', ld.flag('a'));
    const { ex, run } = setup(ld.client, [shell('a')]);
    const out = await ex.run(run);
    expect(out.steps[0]!.error).toMatch(/appeared since planning/);
  });

  it('undo deletes what the run created, dependents first', async () => {
    const ld = fakeLd();
    const { ex, run } = setup(ld.client, [shell('a'), shell('b'), env('a'), env('b', ['shell:b', 'env:test:a'])]);
    await ex.run(run);
    ld.calls.length = 0;
    const out = await ex.undo(run);
    expect(out.status).toBe('undone');
    expect(ld.calls.filter((c) => c.startsWith('delete'))).toEqual(['delete b', 'delete a']);
  });

  it('a dry run writes nothing for new flags and passes dryRun for existing ones', async () => {
    const ld = fakeLd();
    const { ex } = setup(ld.client, []);
    const dry = newRun({ id: 'dry-1', workspaceId: 'w', projectKey: 'p', label: 'dry', dryRun: true, steps: [shell('a'), env('a')], now: new Date() });
    const out = await ex.run(dry);
    expect(out.steps.map((s) => s.message)).toEqual(['Would create boolean flag “a” (statsig-migrated, statsig-src-web).', 'Would set targeting in test: on, 0 rules, default true.']);
    expect(ld.calls.filter((c) => !c.startsWith('get'))).toEqual([]);
  });
});

describe('segment provenance footer', () => {
  describe('autotunes → bandits', () => {
    const jsonShell = (key: string): PlanStep => ({
      ...(shell(key) as Extract<PlanStep, { op: 'upsert_flag_shell' }>),
      desired: {
        ...(shell(key) as Extract<PlanStep, { op: 'upsert_flag_shell' }>).desired,
        variations: [
          { value: { copy: 'A' }, name: 'A' },
          { value: { copy: 'B' }, name: 'B' },
        ],
        customProperties: { 'statsig.id': { name: 'StatSig ID', value: [key] }, 'statsig.type': { name: 'StatSig type', value: ['autotune'] }, 'statsig.source': { name: 'StatSig source', value: ['web'] } },
      },
    });
    const metric: PlanStep = {
      id: 'metric:promo_click',
      deps: [],
      op: 'upsert_metric',
      key: 'promo_click',
      exists: false,
      adopt: false,
      desired: { key: 'promo_click', name: 'promo_click', description: '', kind: 'custom', eventKey: 'promo_click', isNumeric: false, successCriteria: 'HigherThanBaseline', tags: ['statsig-migrated', 'statsig-src-web'], analysisUnits: ['user'] },
      provenance: { sourceAlias: 'web', statsigType: 'metric', statsigId: 'promo_click', statsigFingerprint: 'fp', decisionSetHash: 'dh' },
    };
    const unit: PlanStep = { id: 'randomization_unit:company', deps: [], op: 'ensure_randomization_unit', key: 'company' };
    const bandit = (key: string): PlanStep => ({
      id: `bandit:test:${key}`,
      deps: [`env:test:${key}`, 'metric:promo_click'],
      op: 'create_bandit',
      key,
      ldEnv: 'test',
      statsigEnv: 'staging',
      flagKey: key,
      exists: false,
      adopt: false,
      desired: {
        key,
        ldEnv: 'test',
        statsigEnv: 'staging',
        name: key,
        description: 'Bandit',
        hypothesis: 'h',
        flagKey: key,
        ruleId: 'fallthrough',
        treatments: [
          { name: 'A', baseline: true, allocationPercent: '50', variation: 0 },
          { name: 'B', baseline: false, allocationPercent: '50', variation: 1 },
        ],
        metricKey: 'promo_click',
        randomizationUnit: 'user',
        reallocationFrequencyMillis: 3_600_000,
        tags: ['statsig-migrated', 'statsig-src-web'],
      },
      provenance: { sourceAlias: 'web', statsigType: 'autotune', statsigId: key, statsigVersion: 2, statsigFingerprint: 'fp', decisionSetHash: 'dh' },
    });
    const jsonFlag = (ld: ReturnType<typeof fakeLd>, key: string): LdFlag => ({
      ...ld.flag(key, { tags: ['statsig-migrated', 'statsig-src-web'], customProperties: { 'statsig.id': { name: 'StatSig ID', value: [key] }, 'statsig.source': { name: 'StatSig source', value: ['web'] } } }),
      variations: [
        { _id: `${key}-a`, value: { copy: 'A' } },
        { _id: `${key}-b`, value: { copy: 'B' } },
      ],
      environments: { test: { on: false, offVariation: 0, fallthrough: { variation: 0 }, rules: [], targets: [], version: 7 } },
    });

    it('creates the metric, the randomization unit and a drafted mab experiment with variation IDs and the flag version', async () => {
      const ld = fakeLd();
      ld.flags.set('promo', jsonFlag(ld, 'promo'));
      const jsonEnv: PlanStep = {
        ...(env('promo') as Extract<PlanStep, { op: 'update_flag_env' }>),
        variations: [{ copy: 'A' }, { copy: 'B' }],
        desired: { ...desiredEnv, on: false, offVariation: 0, fallthrough: { rollout: { contextKind: 'user', variations: [{ variation: 0, weight: 50_000 }, { variation: 1, weight: 50_000 }] } } },
      };
      const { ex, run } = setup(ld.client, [unit, metric, { ...(jsonShell('promo') as Extract<PlanStep, { op: 'upsert_flag_shell' }>), exists: true }, jsonEnv, bandit('promo')]);
      const out = await ex.run(run);
      expect(out.steps.map((s) => s.error ?? '')).toEqual(['', '', '', '', '']);
      expect(out.status).toBe('done');
      expect(ld.calls.filter((c) => !c.startsWith('get'))).toEqual([
        'put settings user,company',
        'create metric promo_click',
        'json promo /clientSideAvailability,/customProperties/statsig.type',
        'semantic promo test',
        'json promo /customProperties/statsig.sync.test',
        'create experiment test/promo',
      ]);
      const created = ld.experiments.get('test/promo')!;
      expect(created.type).toBe('mab');
      expect(created.iteration).toMatchObject({
        primarySingleMetricKey: 'promo_click',
        randomizationUnit: 'user',
        reallocationFrequencyMillis: 3_600_000,
        treatments: [
          { name: 'A', baseline: true, allocationPercent: '50', parameters: [{ flagKey: 'promo', variationId: 'promo-a' }] },
          { name: 'B', baseline: false, allocationPercent: '50', parameters: [{ flagKey: 'promo', variationId: 'promo-b' }] },
        ],
        flags: { promo: { ruleId: 'fallthrough', flagConfigVersion: 7, notInExperimentVariationId: 'promo-a' } },
      });
      expect(out.steps.map((s) => s.created ?? false)).toEqual([true, true, false, false, true]);
    });

    it('replaces a draft iteration on re-sync, leaves a running one alone, and reuses a same-event metric', async () => {
      const ld = fakeLd();
      ld.flags.set('promo', jsonFlag(ld, 'promo'));
      ld.metrics.set('promo_click', { key: 'promo_click', kind: 'custom', eventKey: 'promo_click', tags: ['other'] });
      ld.experiments.set('test/promo', { key: 'promo', name: 'promo', type: 'mab', tags: ['statsig-migrated', 'statsig-src-web'], draftIteration: { status: 'not_started', hypothesis: '' } });
      const { ex, run } = setup(ld.client, [metric, bandit('promo')]);
      const out = await ex.run(run);
      expect(out.status).toBe('done');
      expect(ld.calls.filter((c) => !c.startsWith('get'))).toEqual(['json metric promo_click /tags', 'iteration test/promo']);
      ld.experiments.set('test/promo', { key: 'promo', name: 'promo', type: 'mab', tags: ['statsig-migrated', 'statsig-src-web'], currentIteration: { status: 'running', hypothesis: '' } });
      const again = await ex.run(newRun({ id: 'run-2', workspaceId: 'w', projectKey: 'p', label: 't', dryRun: false, steps: [bandit('promo')], now: new Date() }));
      expect(again.steps[0]!.message).toMatch(/running iteration; left as is/);
    });

    it('undo archives the experiment it created, deletes its metric and restores the randomization units', async () => {
      const ld = fakeLd();
      ld.flags.set('promo', jsonFlag(ld, 'promo'));
      const { ex, run } = setup(ld.client, [unit, metric, bandit('promo')]);
      const done = await ex.run(run);
      ld.calls.length = 0;
      const undone = await ex.undo(done);
      expect(undone.status).toBe('undone');
      expect(ld.calls.filter((c) => !c.startsWith('get'))).toEqual(['semantic experiment test/promo archiveExperiment', 'delete metric promo_click', 'put settings user']);
    });
  });

  it('round-trips and replaces an old footer', () => {
    const f = footer({ sourceAlias: 'web', statsigId: 'vip', statsigFingerprint: 'abc', decisionSetHash: 'd' }, new Date('2026-10-22T00:00:00Z'));
    const once = withFooter('VIPs', f);
    expect(withFooter(once, f)).toBe(once);
    expect(parseFooter(once)).toEqual({ src: 'web', id: 'vip', fp: 'abc', d: 'd', at: '2026-10-22T00:00:00.000Z' });
  });
});
