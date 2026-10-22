import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CanonicalSnapshot, Gate } from '@sslm/canonical';
import { caseFoldedPattern, mapGate, mapSegment, type MapArgs, type Resolution } from '../src/index.ts';
import { acmeSnapshot, CAPS, NOW, profileFor, server } from './fixtures.ts';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

const MAPPING = { development: null, staging: 'test', production: 'production', qa: null };
let web: CanonicalSnapshot;
beforeAll(async () => {
  web = await acmeSnapshot('web');
});

function args(gateId: string, over: Partial<MapArgs<Gate>> = {}): MapArgs<Gate> {
  const entity = web.gates.find((g) => g.id === gateId)!;
  return { canonical: { snapshot: web }, entity, profile: profileFor(web, MAPPING), resolutions: new Map(), capabilities: CAPS, env: { statsig: 'production', ld: 'production' }, now: NOW, ...over };
}

const types = (r: { unresolved: { type: string }[] }) => r.unresolved.map((d) => d.type).sort();

describe('operator pitfalls (CLAUDE.md, PLAN §10.3)', () => {
  it('version_gte → NOT semVerLessThan', () => {
    const r = mapGate(args('windows_download_cta'));
    expect(r.env.rules[0]!.clauses[1]).toEqual({ contextKind: 'user', attribute: 'osVersion', op: 'semVerLessThan', values: ['10.0.0'], negate: true });
  });

  it('`any` is case-insensitive in StatSig, so it needs a decision; the recommended regex is exact', () => {
    const r = mapGate(args('search_v2'));
    expect(types(r)).toEqual(['case_insensitive_match', 'case_insensitive_match', 'client_side_availability']);
    const re = new RegExp(r.env.rules[0]!.clauses[0]!.values[0] as string);
    expect(['Pro', 'pro', 'PRO', 'pRo'].every((v) => re.test(v))).toBe(true);
    expect(re.test('Proton')).toBe(false);
  });

  it('str_contains_any is case-insensitive too (StatSig Evaluator stringCompare(true, …))', () => {
    expect(types(mapGate(args('employees_only')))).toContain('case_insensitive_match');
  });

  it('values without cased letters need no decision', () => {
    const r = mapGate(args('maintenance_mode'));
    expect(types(r)).toEqual(['client_side_availability']);
    expect(r.env.rules[0]!.clauses[0]).toMatchObject({ attribute: 'ip', op: 'in', values: ['10.0.0.1', '10.0.0.2'] });
  });

  it('environment_tier is resolved statically per environment', () => {
    expect(mapGate(args('staff_debug_tools')).env.rules).toEqual([]);
    const staging = mapGate(args('staff_debug_tools', { env: { statsig: 'staging', ld: 'test' } }));
    expect(staging.env.fallthrough).toEqual({ variation: 0 });
  });

  it('custom unit IDs map to their own context kind, not user', () => {
    const r = mapGate(args('b2b_bulk_ordering'));
    expect(r.env.rules[0]!.clauses[0]!.contextKind).toBe('company');
    expect(r.env.targets.map((t) => t.contextKind)).toEqual(['company', 'company']);
    expect(r.dependencies).toContainEqual({ kind: 'context_kind', key: 'company', entityId: 'companyID' });
    expect(types(r)).toContain('unit_type_kind');
  });

  it('a configured unit type → kind mapping needs no decision', () => {
    const profile = profileFor(web, MAPPING);
    profile.sources[web.source.sourceId]!.unitTypeKinds.companyID = 'account';
    const r = mapGate(args('b2b_bulk_ordering', { profile }));
    expect(types(r)).not.toContain('unit_type_kind');
    expect(r.env.rules[0]!.clauses[0]!.contextKind).toBe('account');
  });

  it('case-folded patterns escape regex metacharacters', () => {
    expect(caseFoldedPattern('a.b+', 'full')).toBe('^[aA]\\.[bB]\\+$');
    expect(new RegExp(caseFoldedPattern('@Acme.example', 'none')).test('x@ACME.EXAMPLE')).toBe(true);
  });
});

describe('gate references (PLAN §10.4)', () => {
  it('inlines a referenced gate without partial rollouts', () => {
    const r = mapGate(args('checkout_promo_banner'));
    expect(r.env.rules).toHaveLength(1);
    expect(r.env.rules[0]!.clauses[0]).toMatchObject({ attribute: 'email', op: 'matches' });
    expect(r.env.prerequisites).toEqual([]);
  });

  it('offers a prerequisite when the referenced gate has a partial rollout', () => {
    const r = mapGate(args('checkout_express_pay'));
    const d = r.unresolved.find((x) => x.type === 'gate_reference')!;
    expect(d.recommended).toBe('prerequisite');
    expect(r.env.prerequisites).toEqual([{ key: 'new_checkout_flow', variation: 0 }]);
    expect(r.dependencies).toContainEqual({ kind: 'flag', key: 'new_checkout_flow', entityId: 'new_checkout_flow' });
  });

  it('makes the gate reference blocking when prerequisites are unavailable', () => {
    const r = mapGate(args('checkout_express_pay', { capabilities: { ...CAPS, prerequisites: 'unavailable' } }));
    const d = r.unresolved.find((x) => x.type === 'gate_reference')!;
    expect(d.severity).toBe('blocking');
    expect(d.options.map((o) => o.key)).toEqual(['drop_condition', 'drop_rule', 'skip']);
  });

  it('inlined gates feed the fingerprint, so a change in the referenced gate is drift', () => {
    const before = mapGate(args('checkout_promo_banner')).statsigFingerprint;
    const changed: CanonicalSnapshot = { ...web, gates: web.gates.map((g) => (g.id === 'employees_only' ? { ...g, enabled: false } : g)) };
    expect(mapGate(args('checkout_promo_banner', { canonical: { snapshot: changed }, entity: changed.gates.find((g) => g.id === 'checkout_promo_banner')! })).statsigFingerprint).not.toBe(before);
  });
});

describe('time, null and unsupported conditions', () => {
  it('resolves a time window entirely in the past statically', () => {
    const r = mapGate(args('holiday_sale_2025'));
    expect(types(r)).toEqual(['client_side_availability']);
    expect(r.env.rules).toEqual([]);
  });

  it('asks about a time condition in the future', () => {
    expect(types(mapGate(args('black_friday_2027')))).toContain('time_condition');
    const later = mapGate(args('black_friday_2027', { now: '2028-01-01T00:00:00.000Z' }));
    expect(types(later)).not.toContain('time_condition');
    expect(later.env.fallthrough).toEqual({ variation: 0 });
  });

  it('is_null has no safe default', () => {
    const d = mapGate(args('missing_email_prompt')).unresolved.find((x) => x.type === 'null_check')!;
    expect(d.severity).toBe('blocking');
    expect(d.recommended).toBeUndefined();
  });

  it('url and target_app conditions are blocking decisions, never dropped silently', () => {
    for (const id of ['storefront_url_banner', 'storefront_app_only']) {
      const d = mapGate(args(id)).unresolved.find((x) => x.type === 'unsupported_condition')!;
      expect(d.severity).toBe('blocking');
    }
  });

  it('big and unloaded ID lists block the gate', () => {
    expect(mapGate(args('block_fraudulent_checkout')).unresolved.map((d) => [d.type, d.severity])).toContainEqual(['big_segment', 'blocking']);
    expect(mapGate(args('wholesale_portal')).unresolved.map((d) => d.type)).toContain('id_list_unavailable');
  });

  it('a fetched ID list unblocks the segment and the gate', () => {
    const seg = web.segments.find((s) => s.id === 'wholesale_partners')!;
    const ids = Array.from({ length: 2500 }, (_, i) => `partner-${String(i + 1).padStart(5, '0')}`);
    const canonical = { snapshot: web, idLists: { [seg.uid]: ids } };
    expect(mapGate(args('wholesale_portal', { canonical })).unresolved.map((d) => d.type)).toEqual(['client_side_availability']);
    const s = mapSegment({ ...args('wholesale_portal', { canonical }), entity: seg });
    expect(s.desired?.included).toHaveLength(2500);
  });
});

describe('overrides and rollouts', () => {
  it('environment-specific overrides apply only in their environment', () => {
    const prod = mapGate(args('new_checkout_flow'));
    const staging = mapGate(args('new_checkout_flow', { env: { statsig: 'staging', ld: 'test' } }));
    const pass = (r: typeof prod) => r.env.targets.find((t) => t.variation === 0)!.values;
    expect(pass(prod)).toEqual(['user-qa-1', 'user-qa-2']);
    expect(pass(staging)).toEqual(['user-staging-tester', 'user-qa-1', 'user-qa-2']);
  });

  it('a public partial rollout becomes the fallthrough rollout and needs an acknowledgement', () => {
    const r = mapGate(args('new_checkout_flow'));
    expect(r.env.fallthrough.rollout?.variations).toEqual([
      { variation: 0, weight: 20_000 },
      { variation: 1, weight: 80_000 },
    ]);
    expect(r.unresolved.find((d) => d.type === 'partial_rollout_rebucket')?.severity).toBe('acknowledge');
  });

  it('a disabled gate is off in LD and serves false', () => {
    const r = mapGate(args('old_cart_drawer'));
    expect(r.env.on).toBe(false);
    expect(r.env.offVariation).toBe(1);
  });

  it('archived gates are skipped', () => {
    expect(mapGate(args('legacy_wishlist')).skipped).toBe('archived in StatSig');
  });
});

describe('resolutions (PLAN §8.1)', () => {
  const resolve = (r: ReturnType<typeof mapGate>, type: string, optionKey: string): Resolution => {
    const d = r.unresolved.find((x) => x.type === type)!;
    return { id: d.id, type: d.type, optionKey, scope: 'resource', fingerprint: d.fingerprint, decidedAt: NOW };
  };

  it('applies a resource resolution in every environment', () => {
    const first = mapGate(args('search_autocomplete'));
    const res = resolve(first, 'client_side_availability', 'server');
    const resolutions = new Map([[res.id, res]]);
    for (const env of [{ statsig: 'production', ld: 'production' }, { statsig: 'staging', ld: 'test' }]) {
      const r = mapGate(args('search_autocomplete', { resolutions, env }));
      expect(r.unresolved).toEqual([]);
      expect(r.shell.clientSideAvailability).toEqual({ usingEnvironmentId: false, usingMobileKey: false });
      expect(r.applied.map((a) => a.via)).toEqual(['resource']);
    }
  });

  it('a workspace policy answers every decision of its type', () => {
    const profile = { ...profileFor(web, MAPPING), policies: { client_side_availability: 'both', case_insensitive_match: 'variants' } };
    const r = mapGate(args('search_v2', { profile }));
    expect(r.unresolved).toEqual([]);
    expect(r.env.rules[0]!.clauses[0]).toMatchObject({ op: 'in', values: ['Pro', 'pro', 'PRO', 'Enterprise', 'enterprise', 'ENTERPRISE'] });
  });

  it('goes stale when the StatSig fragment changes, and shows the old answer', () => {
    const first = mapGate(args('search_v2'));
    const res = resolve(first, 'case_insensitive_match', 'exact');
    const changed: CanonicalSnapshot = {
      ...web,
      gates: web.gates.map((g) => (g.id !== 'search_v2' ? g : { ...g, rules: g.rules.map((r) => ({ ...r, conditions: r.conditions.map((c, i) => (i === 0 ? { ...c, targetValue: ['Pro', 'Enterprise', 'Team'] } : c)) })) })),
    };
    const entity = changed.gates.find((g) => g.id === 'search_v2')!;
    const r = mapGate(args('search_v2', { canonical: { snapshot: changed }, entity, resolutions: new Map([[res.id, res]]) }));
    expect(r.stale.map((s) => s.previous.optionKey)).toEqual(['exact']);
    expect(r.unresolved.map((d) => d.id)).toContain(res.id);
  });

  it('a "skip" answer skips the item', () => {
    const first = mapGate(args('black_friday_2027'));
    const res = resolve(first, 'time_condition', 'skip');
    expect(mapGate(args('black_friday_2027', { resolutions: new Map([[res.id, res]]) })).skipped).toMatch(/skipped by decision/);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(mapGate(args('new_checkout_flow')))).toBe(JSON.stringify(mapGate(args('new_checkout_flow'))));
  });
});

describe('flag shell and provenance (PLAN §3.3, §10.1)', () => {
  it('keeps the StatSig name as the key, tags provenance, and serves false in unmigrated environments', () => {
    const r = mapGate(args('kill_switch_payments'));
    expect(r.shell).toMatchObject({
      key: 'kill_switch_payments',
      temporary: false,
      tags: ['statsig-migrated', 'statsig-src-web', 'platform'],
      defaults: { onVariation: 1, offVariation: 1 },
      variations: [{ value: true }, { value: false }],
    });
    expect(r.shell.customProperties['statsig.id']).toEqual({ name: 'StatSig ID', value: ['kill_switch_payments'] });
  });
});

describe('profile', () => {
  it('maps environments by key, then by hint, never overwriting a choice', async () => {
    const { reconcileProfile } = await import('../src/index.ts');
    const ld = [
      { key: 'test', name: 'Test' },
      { key: 'production', name: 'Production' },
    ];
    const p = reconcileProfile({ version: 1, sources: {}, attributes: {}, policies: {} }, [web], ld, { staging: 'test' });
    expect(p.sources[web.source.sourceId]!.envMapping).toEqual({ development: null, staging: 'test', production: 'production', qa: null });
    p.sources[web.source.sourceId]!.envMapping.staging = null;
    expect(reconcileProfile(p, [web], ld, { staging: 'test' }).sources[web.source.sourceId]!.envMapping.staging).toBeNull();
  });
});
