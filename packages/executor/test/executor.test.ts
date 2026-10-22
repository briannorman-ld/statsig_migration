import { describe, expect, it } from 'vitest';
import { LdAuthError, LdWriteError, type LdFlag } from '@sslm/ld-client';
import type { PlanStep } from '@sslm/planner';
import { Executor, footer, newRun, parseFooter, withFooter, type LdWriter, type RunRecord } from '../src/index.ts';

/** Minimal in-memory LD: enough state for the executor's control flow, not LD's semantics. */
function fakeLd(over: Partial<Record<keyof LdWriter, (...a: never[]) => unknown>> = {}) {
  const flags = new Map<string, LdFlag>();
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
  };
  return { client: { ...base, ...over } as LdWriter, flags, calls, flag };
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
  it('round-trips and replaces an old footer', () => {
    const f = footer({ sourceAlias: 'web', statsigId: 'vip', statsigFingerprint: 'abc', decisionSetHash: 'd' }, new Date('2026-10-22T00:00:00Z'));
    const once = withFooter('VIPs', f);
    expect(withFooter(once, f)).toBe(once);
    expect(parseFooter(once)).toEqual({ src: 'web', id: 'vip', fp: 'abc', d: 'd', at: '2026-10-22T00:00:00.000Z' });
  });
});
