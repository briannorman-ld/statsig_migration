import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CanonicalSnapshot } from '@sslm/canonical';
import type { Resolution } from '@sslm/mapper';
import { migrationStatus, planMigration, recommendedResolutions, syncPropertyKey, type LdProjectState, type PlanRequest } from '../src/index.ts';
import { acmeSnapshot, CAPS, NOW, profileFor, server } from './fixtures.ts';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

let web: CanonicalSnapshot;
beforeAll(async () => {
  web = await acmeSnapshot('web');
});

const EMPTY_LD: LdProjectState = { flags: new Map(), segments: {}, contextKinds: ['user'], criticalEnvs: ['production'] };
const uid = (id: string) => web.gates.find((g) => g.id === id)!.uid;

function request(gates: string[], over: Partial<PlanRequest> = {}): PlanRequest {
  return {
    gates: gates.map(uid),
    ldEnvs: ['test'],
    snapshots: [web],
    profile: profileFor(web, { development: null, staging: 'test', production: 'production', qa: null }),
    resolutions: new Map(),
    capabilities: CAPS,
    ld: EMPTY_LD,
    now: NOW,
    ...over,
  };
}

/** Accept every recommended option, including acknowledgements (what a user clicking through does). */
function acceptAll(req: PlanRequest): PlanRequest {
  let r = req;
  for (let i = 0; i < 5; i++) {
    const plan = planMigration(r);
    if (plan.decisions.length === 0) break;
    const res = new Map(r.resolutions);
    for (const x of recommendedResolutions(plan.decisions, NOW)) res.set(x.id, x);
    for (const d of plan.decisions.filter((d) => d.severity === 'acknowledge')) res.set(d.id, { id: d.id, type: d.type, optionKey: d.recommended!, scope: 'resource', fingerprint: d.fingerprint, decidedAt: NOW });
    r = { ...r, resolutions: res };
  }
  return r;
}

describe('planMigration', () => {
  it('blocks until decisions are made, then orders segments → shells → environments', () => {
    const blocked = planMigration(request(['new_checkout_flow']));
    expect(blocked.ready).toBe(false);
    expect(blocked.steps).toEqual([]);
    expect(blocked.decisions.map((d) => d.type).sort()).toEqual(['case_insensitive_match', 'case_insensitive_match', 'case_insensitive_match', 'client_side_availability', 'partial_rollout_rebucket']);

    const plan = planMigration(acceptAll(request(['new_checkout_flow'])));
    expect(plan.ready).toBe(true);
    expect(plan.steps.map((s) => s.id)).toEqual(['segment:test:beta_testers', 'shell:new_checkout_flow', 'env:test:new_checkout_flow']);
    expect(plan.items.find((i) => i.entityId === 'beta_testers')).toMatchObject({ kind: 'segment', dependency: true, status: 'ready' });
  });

  it('blocks a gate whose segment cannot migrate (docs/KNOWN-EDGE-CASES.md 5.7, 9.8)', () => {
    const plan = planMigration(acceptAll(request(['early_adopter_badge'])));
    expect(plan.ready).toBe(false);
    expect(plan.items.find((i) => i.entityId === 'early_adopters')).toMatchObject({ kind: 'segment', status: 'skipped', reason: expect.stringMatching(/can't be inlined/) });
    expect(plan.items.find((i) => i.entityId === 'early_adopter_badge')).toMatchObject({ status: 'blocked', reason: expect.stringMatching(/depends on/) });
  });

  it('pulls in a prerequisite gate and migrates it first in the same environment', () => {
    const plan = planMigration(acceptAll(request(['checkout_express_pay'])));
    expect(plan.ready).toBe(true);
    const ids = plan.steps.map((s) => s.id);
    expect(ids.indexOf('env:test:new_checkout_flow')).toBeLessThan(ids.indexOf('env:test:checkout_express_pay'));
    expect(plan.items.find((i) => i.entityId === 'new_checkout_flow')).toMatchObject({ dependency: true, requiredBy: [uid('checkout_express_pay')] });
  });

  it('creates context kinds before the flags that use them', () => {
    const plan = planMigration(acceptAll(request(['b2b_bulk_ordering'])));
    expect(plan.steps.map((s) => s.id)).toEqual(['context_kind:company', 'shell:b2b_bulk_ordering', 'env:test:b2b_bulk_ordering']);
    expect(plan.steps.find((s) => s.id === 'env:test:b2b_bulk_ordering')!.deps).toContain('context_kind:company');
  });

  it("doesn't write a dependency whose only dependent is blocked", () => {
    const base = acceptAll(request(['new_checkout_flow']));
    const ack = [...base.resolutions.values()].find((r) => r.type === 'partial_rollout_rebucket')!;
    const resolutions = new Map(base.resolutions);
    resolutions.delete(ack.id);
    const plan = planMigration({ ...base, resolutions });
    expect(plan.items.find((i) => i.entityId === 'beta_testers')!.status).toBe('ready');
    expect(plan.steps).toEqual([]);
  });

  it('keeps ready items when another item is blocked by a blocking decision', () => {
    const plan = planMigration(acceptAll(request(['kill_switch_payments', 'missing_email_prompt'])));
    expect(plan.ready).toBe(false);
    expect(plan.items.find((i) => i.entityId === 'missing_email_prompt')!.status).toBe('blocked');
    expect(plan.steps.map((s) => s.id)).toEqual(['shell:kill_switch_payments', 'env:test:kill_switch_payments']);
  });

  it('refuses an LD environment with no StatSig environment mapped to it', () => {
    const plan = planMigration(request(['kill_switch_payments'], { ldEnvs: ['sandbox'] }));
    expect(plan.items[0]).toMatchObject({ status: 'error' });
    expect(plan.items[0]!.reason).toMatch(/no StatSig environment/);
  });

  it('asks before touching an LD flag the app did not create (ownership guard)', () => {
    const ld: LdProjectState = { ...EMPTY_LD, flags: new Map([['kill_switch_payments', { key: 'kill_switch_payments', tags: [], customProperties: {}, kind: 'boolean' }]]) };
    const base = acceptAll(request(['kill_switch_payments']));
    const plan = planMigration({ ...base, ld });
    const d = plan.decisions.find((x) => x.type === 'key_collision')!;
    expect(d.severity).toBe('blocking');
    expect(plan.steps).toEqual([]);

    const adopt: Resolution = { id: d.id, type: d.type, optionKey: 'adopt', scope: 'resource', fingerprint: d.fingerprint, decidedAt: NOW };
    const adopted = planMigration({ ...base, ld, resolutions: new Map([...base.resolutions, [d.id, adopt]]) });
    expect(adopted.steps.find((s) => s.op === 'upsert_flag_shell')).toMatchObject({ exists: true, adopt: true });
  });

  it('flags production for typed confirmation', () => {
    expect(planMigration(acceptAll(request(['kill_switch_payments'], { ldEnvs: ['production'] }))).confirmEnvs).toEqual(['production']);
  });
});

describe('migrationStatus (from LD provenance)', () => {
  const fp = { statsigFingerprint: 'abc', decisionSetHash: 'd1' };
  const flag = (sync?: string[]) => ({
    key: 'x',
    tags: ['statsig-migrated'],
    customProperties: { 'statsig.id': { value: ['x'] }, 'statsig.source': { value: ['web'] }, ...(sync ? { [syncPropertyKey('test')]: { value: sync } } : {}) },
  });
  it('reads in-sync, StatSig-changed and not-migrated states', () => {
    expect(migrationStatus(undefined, 'test', fp).status).toBe('not_in_ld');
    expect(migrationStatus({ key: 'x', tags: [], customProperties: {} }, 'test', fp).status).toBe('foreign');
    expect(migrationStatus(flag(), 'test', fp).status).toBe('not_migrated');
    expect(migrationStatus(flag(['abc', '3', NOW, 'd1']), 'test', fp)).toEqual({ status: 'in_sync', syncedAt: NOW });
    expect(migrationStatus(flag(['old', '2', NOW, 'd1']), 'test', fp).status).toBe('statsig_changed');
    expect(migrationStatus(flag(['abc', '3', NOW, 'd0']), 'test', fp).status).toBe('decisions_changed');
    expect(migrationStatus(flag(['abc', '3', NOW, 'd1']), 'test', fp, { id: 'x', source: 'mobile' }).status).toBe('other_source');
  });
});
