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
    expect(blocked.decisions.map((d) => d.type).sort()).toEqual(['case_insensitive_match', 'case_insensitive_match', 'case_insensitive_match', 'client_side_availability', 'holdout_attached', 'partial_rollout_rebucket']);

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

describe('autotunes (PLAN §11)', () => {
  const auid = (id: string) => web.autotunes.find((a) => a.id === id)!.uid;

  it('plans metric → shell → targeting → drafted bandit, with a randomization unit for custom kinds', () => {
    const plan = planMigration(acceptAll(request([], { autotunes: [auid('hero_image_autotune'), auid('b2b_pricing_autotune')] })));
    expect(plan.errors).toEqual([]);
    expect(plan.ready).toBe(true);
    expect(plan.steps.map((s) => s.id)).toEqual([
      'context_kind:company',
      'randomization_unit:company',
      'metric:hero_click',
      'metric:quote_requested',
      'shell:b2b_pricing_autotune',
      'shell:hero_image_autotune',
      'env:test:b2b_pricing_autotune',
      'env:test:hero_image_autotune',
      'bandit:test:b2b_pricing_autotune',
      'bandit:test:hero_image_autotune',
    ]);
    const bandit = plan.steps.find((s) => s.id === 'bandit:test:hero_image_autotune')!;
    expect(bandit.op === 'create_bandit' && bandit.deps).toEqual(['env:test:hero_image_autotune', 'metric:hero_click']);
    expect(plan.items.filter((i) => i.kind === 'metric').map((i) => [i.ldKey, i.dependency])).toEqual([
      ['hero_click', true],
      ['quote_requested', true],
    ]);
    const env = plan.steps.find((s) => s.id === 'env:test:hero_image_autotune')!;
    expect(env.op === 'update_flag_env' && env.provenance.statsigType).toBe('autotune');
  });

  it('a running autotune is skipped until its decision is answered; a concluded one needs no bandit', () => {
    const plan = planMigration(request([], { autotunes: [auid('promo_banner_autotune'), auid('pricing_page_autotune')] }));
    expect(plan.decisions.map((d) => d.type)).toContain('autotune_running');
    expect(plan.items.find((i) => i.entityId === 'promo_banner_autotune')!.status).toBe('blocked');
    const done = planMigration(acceptAll(request([], { autotunes: [auid('promo_banner_autotune'), auid('pricing_page_autotune')] })));
    // "Wait" is the recommended answer: the running autotune stays in StatSig.
    expect(done.items.find((i) => i.entityId === 'promo_banner_autotune')).toMatchObject({ status: 'skipped' });
    expect(done.steps.map((s) => s.op)).toEqual(['upsert_flag_shell', 'update_flag_env']);
    expect(done.steps.some((s) => s.op === 'create_bandit' || s.op === 'upsert_metric')).toBe(false);
  });

  it('reuses an existing LD metric on the same event silently, and asks about a foreign one', () => {
    const base = acceptAll(request([], { autotunes: [auid('hero_image_autotune')] }));
    const same = planMigration({ ...base, ld: { ...EMPTY_LD, metrics: new Map([['hero_click', { key: 'hero_click', tags: [], eventKey: 'hero_click', kind: 'custom' }]]) } });
    expect(same.ready).toBe(true);
    expect(same.steps.find((s) => s.op === 'upsert_metric')).toMatchObject({ exists: true, adopt: true });
    const foreign = planMigration({ ...base, ld: { ...EMPTY_LD, metrics: new Map([['hero_click', { key: 'hero_click', tags: [], eventKey: 'Hero clicked', kind: 'custom' }]]) } });
    expect(foreign.decisions.map((d) => d.type)).toEqual(['key_collision']);
    expect(foreign.items.find((i) => i.kind === 'metric')!.status).toBe('blocked');
  });

  it('asks before touching an LD experiment the app did not create, and skips the randomization unit when enabled', () => {
    const base = acceptAll(request([], { autotunes: [auid('b2b_pricing_autotune')] }));
    const plan = planMigration({
      ...base,
      ld: { ...EMPTY_LD, randomizationUnits: ['user', 'company'], contextKinds: ['user', 'company'], experiments: { test: new Map([['b2b_pricing_autotune', { key: 'b2b_pricing_autotune', tags: [], type: 'mab', iterationStatus: 'running' }]]) } },
    });
    expect(plan.decisions.map((d) => d.type)).toEqual(['key_collision']);
    const adopted = planMigration({ ...base, ld: { ...EMPTY_LD, randomizationUnits: ['user', 'company'], contextKinds: ['user', 'company'], experiments: { test: new Map([['b2b_pricing_autotune', { key: 'b2b_pricing_autotune', tags: [], type: 'mab' }]]) } }, resolutions: new Map([...base.resolutions, [plan.decisions[0]!.id, { id: plan.decisions[0]!.id, type: 'key_collision' as const, optionKey: 'adopt', scope: 'resource' as const, fingerprint: plan.decisions[0]!.fingerprint, decidedAt: NOW }]]) });
    expect(adopted.ready).toBe(true);
    expect(adopted.steps.map((s) => s.id)).toEqual(['metric:quote_requested', 'shell:b2b_pricing_autotune', 'env:test:b2b_pricing_autotune', 'bandit:test:b2b_pricing_autotune']);
    expect(adopted.steps.find((s) => s.op === 'create_bandit')).toMatchObject({ exists: true, adopt: true });
  });
});

describe('dynamic configs (PLAN §10.1; edge cases 1.2, 10.1, 10.8)', () => {
  const cuid = (id: string) => web.configs.find((c) => c.id === id)!.uid;
  const owned = (key: string, type: 'gate' | 'config', extra: Partial<LdProjectState['flags'] extends ReadonlyMap<string, infer V> ? V : never> = {}) => ({
    key,
    tags: ['statsig-migrated', 'statsig-src-web'],
    customProperties: { 'statsig.id': { value: [key] }, 'statsig.source': { value: ['web'] }, 'statsig.type': { value: [type] } },
    kind: type === 'gate' ? 'boolean' : 'multivariate',
    ...extra,
  });

  it('plans a JSON flag shell with the default first, then the environment targeting', () => {
    const plan = planMigration(acceptAll(request([], { configs: [cuid('shipping_thresholds'), cuid('b2b_order_limits')] })));
    expect(plan.errors).toEqual([]);
    expect(plan.ready).toBe(true);
    expect(plan.steps.map((s) => s.id)).toEqual(['context_kind:company', 'segment:test:enterprise_accounts', 'shell:b2b_order_limits', 'shell:shipping_thresholds', 'env:test:b2b_order_limits', 'env:test:shipping_thresholds']);
    const shell = plan.steps.find((s) => s.id === 'shell:shipping_thresholds')!;
    expect(shell.op === 'upsert_flag_shell' && shell.desired.variations.map((v) => v.name)).toEqual(['Default', 'UK', 'Canada']);
    const env = plan.steps.find((s) => s.id === 'env:test:shipping_thresholds')!;
    expect(env.op === 'update_flag_env' && env.variations.length).toBe(3);
    expect(env.op === 'update_flag_env' && env.provenance.statsigType).toBe('config');
    expect(plan.items.find((i) => i.entityId === 'shipping_thresholds')).toMatchObject({ kind: 'config', status: 'ready' });
  });

  it('1.2 / 10.8: a gate and a config with the same name cannot both become one LD key', () => {
    const plan = planMigration(acceptAll(request(['maintenance_mode'], { configs: [cuid('maintenance_mode')] })));
    expect(plan.items.find((i) => i.kind === 'gate' && i.entityId === 'maintenance_mode')).toMatchObject({ status: 'ready' });
    expect(plan.items.find((i) => i.kind === 'config' && i.entityId === 'maintenance_mode')).toMatchObject({ status: 'error', reason: expect.stringMatching(/gate “maintenance_mode” also produces LD key/) });
    expect(plan.steps.map((s) => s.id)).toEqual(['shell:maintenance_mode', 'env:test:maintenance_mode']);
  });

  it('refuses to turn a flag migrated from the gate of the same name into the config, and vice versa', () => {
    const ld: LdProjectState = { ...EMPTY_LD, flags: new Map([['maintenance_mode', owned('maintenance_mode', 'gate')]]) };
    const asConfig = planMigration(acceptAll(request([], { configs: [cuid('maintenance_mode')], ld })));
    expect(asConfig.items[0]).toMatchObject({ status: 'error', reason: expect.stringMatching(/migrated from the StatSig gate of the same name/) });
    const ld2: LdProjectState = { ...EMPTY_LD, flags: new Map([['maintenance_mode', owned('maintenance_mode', 'config')]]) };
    const asGate = planMigration(acceptAll(request(['maintenance_mode'], { ld: ld2 })));
    expect(asGate.items[0]).toMatchObject({ status: 'error', reason: expect.stringMatching(/migrated from the StatSig config of the same name/) });
  });

  it('10.1: appending a variation to a flag already migrated elsewhere is acknowledged first; variations are never removed', async () => {
    const web2 = await acmeSnapshot('web', 2); // shipping_thresholds gains "Australia"
    const before = planMigration(acceptAll(request([], { configs: [cuid('shipping_thresholds')] })));
    const shell = before.steps.find((s) => s.id === 'shell:shipping_thresholds')!;
    const variations = shell.op === 'upsert_flag_shell' ? shell.desired.variations : [];
    const ld: LdProjectState = {
      ...EMPTY_LD,
      flags: new Map([['shipping_thresholds', owned('shipping_thresholds', 'config', { variations, customProperties: { ...owned('x', 'config').customProperties, 'statsig.id': { value: ['shipping_thresholds'] }, [syncPropertyKey('production')]: { value: ['fp', '5', NOW, 'd'] } } })]]),
    };
    const req = acceptAll(request([], { configs: [cuid('shipping_thresholds')], snapshots: [web2], ld }));
    const blocked = planMigration({ ...req, resolutions: new Map([...req.resolutions].filter(([, r]) => r.type !== 'variation_change_affects_migrated_env')) });
    const d = blocked.decisions.find((x) => x.type === 'variation_change_affects_migrated_env')!;
    expect(d).toMatchObject({ severity: 'acknowledge', title: expect.stringMatching(/“Australia”.*production/) });
    expect(blocked.items[0]).toMatchObject({ status: 'blocked' });

    const acknowledged = planMigration(req);
    expect(acknowledged.ready).toBe(true);
    const next = acknowledged.steps.find((s) => s.id === 'shell:shipping_thresholds')!;
    expect(next.op === 'upsert_flag_shell' && next.desired.variations.map((v) => v.name)).toEqual(['Default', 'UK', 'Canada', 'Australia']);

    // Syncing production in the same plan means no other environment is affected: nothing to acknowledge.
    const both = planMigration(acceptAll(request([], { configs: [cuid('shipping_thresholds')], snapshots: [web2], ld, ldEnvs: ['test', 'production'] })));
    expect(both.decisions.map((x) => x.type)).not.toContain('variation_change_affects_migrated_env');
    expect(both.ready).toBe(true);
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
