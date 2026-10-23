import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CanonicalSnapshot, Condition, Gate } from '@sslm/canonical';
import { caseFoldedPattern, mapAutotune, mapGate, mapSegment, type MapArgs, type Resolution } from '../src/index.ts';
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
    // unit_type_kind: search_v2 has a custom-ID override on a userID gate (see edge cases below).
    expect(types(r)).toEqual(['case_insensitive_match', 'case_insensitive_match', 'client_side_availability', 'unit_type_kind']);
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
    // user-vip-complainer fails in every environment but passes in staging: the environment-specific
    // override wins there, and the conflict is reported.
    expect(pass(staging)).toEqual(['user-staging-tester', 'user-vip-complainer', 'user-qa-1', 'user-qa-2']);
    expect(staging.env.targets.find((t) => t.variation === 1)).toBeUndefined();
    expect(staging.fidelity.notes.map((n) => n.message)).toContainEqual(expect.stringMatching(/1 ID is overridden both to pass and to fail/));
    expect(prod.env.targets.find((t) => t.variation === 1)!.values).toEqual(['user-vip-complainer']);
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
    const profile = { ...profileFor(web, MAPPING), policies: { client_side_availability: 'both', case_insensitive_match: 'variants', unit_type_kind: 'create:custom' } };
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

/**
 * One test per row of docs/KNOWN-EDGE-CASES.md that the mapper handles (or knowingly doesn't).
 * Keep the two in sync: a new row there gets a demo example in packages/demo-fixtures and a
 * test here.
 */
describe('known edge cases (docs/KNOWN-EDGE-CASES.md)', () => {
  const clause = (r: ReturnType<typeof mapGate>, rule = 0, cond = 0) => r.env.rules[rule]!.clauses[cond]!;
  /** A copy of `gift_card_upsell` whose single rule has the given conditions (for spec-only operators). */
  const withConditions = (conds: Partial<Condition>[]): Gate => {
    const g = web.gates.find((x) => x.id === 'gift_card_upsell')!;
    return { ...g, rules: [{ ...g.rules[0]!, conditions: conds.map((c) => ({ type: 'custom_field', field: 'plan', operator: null, targetValue: null, raw: c, ...c }) as Condition) }] };
  };

  describe('gate references', () => {
    it('fails_gate on an inlinable gate is inlined as a negation', () => {
      const r = mapGate(args('non_staff_survey'));
      expect(r.fidelity.overall).toBe('full');
      expect(clause(r)).toMatchObject({ attribute: 'email', op: 'matches', negate: true });
    });

    it('fails_gate on a gate with a partial rollout is blocking: no prerequisite can express a negation', () => {
      const r = mapGate(args('express_pay_fallback'));
      const d = r.unresolved.find((x) => x.type === 'gate_reference')!;
      expect(d.severity).toBe('blocking');
      expect(d.options.map((o) => o.key)).toEqual(['drop_condition', 'drop_rule', 'skip']);
    });

    it('fails_gate on a gate with overrides cannot be inlined exactly', () => {
      const d = mapGate(args('consumer_pricing')).unresolved.find((x) => x.type === 'gate_reference')!;
      expect(d.explanation).toMatch(/has overrides/);
    });

    it('passes_gate in only some rules offers no prerequisite', () => {
      const d = mapGate(args('checkout_upsell_v2')).unresolved.find((x) => x.type === 'gate_reference')!;
      expect(d.severity).toBe('blocking');
      expect(d.options.some((o) => o.key === 'prerequisite')).toBe(false);
    });

    it('gate references that form a cycle cannot be inlined; the planner refuses the prerequisite', () => {
      const tmpl = web.gates.find((g) => g.id === 'checkout_promo_banner')!;
      const ref = (id: string, to: string): Gate => ({
        ...tmpl,
        id,
        uid: `${tmpl.source.sourceId}/gate/${id}`,
        rules: [{ ...tmpl.rules[0]!, conditions: [{ type: 'passes_gate', operator: null, targetValue: to, raw: {} }] }],
      });
      const snapshot: CanonicalSnapshot = { ...web, gates: [...web.gates, ref('cyc_a', 'cyc_b'), ref('cyc_b', 'cyc_a')] };
      const entity = snapshot.gates.find((g) => g.id === 'cyc_a')!;
      const d = mapGate(args('checkout_promo_banner', { canonical: { snapshot }, entity })).unresolved.find((x) => x.type === 'gate_reference')!;
      expect(d.explanation).toMatch(/cycle/);
      // Known gap: the mapper still offers "prerequisite" (every rule requires the gate). LD forbids
      // prerequisite cycles; the planner reports "Prerequisites form a cycle" and refuses the plan.
      expect(d.recommended).toBe('prerequisite');
    });

    it('a rule that would expand into more than 10 LD rules is blocking', () => {
      const r = mapGate(args('cross_sell_matrix'));
      expect(r.unresolved.find((x) => x.type === 'rule_expansion')).toMatchObject({ severity: 'blocking', title: expect.stringMatching(/12 LD rules/) });
      expect(r.env.rules).toEqual([]);
    });
  });

  describe('rules and rollouts', () => {
    it('a 0% rule is an exclusion: it serves false and stops evaluation', () => {
      const r = mapGate(args('reviews_v2'));
      expect(r.env.rules[0]).toMatchObject({ description: 'Exclude load tests', variation: 1 });
      expect(r.env.fallthrough).toEqual({ variation: 0 });
    });

    it('rules after a public 100% rule are unreachable and dropped', () => {
      const r = mapGate(args('free_returns'));
      expect(r.env.rules).toEqual([]);
      expect(r.env.fallthrough).toEqual({ variation: 0 });
      expect(r.fidelity.notes.map((n) => n.message)).toContainEqual(expect.stringMatching(/can never match/));
    });

    it('a gate without rules is on and serves false', () => {
      const r = mapGate(args('payments_v3_scaffold'));
      expect(r.env).toMatchObject({ on: true, rules: [], fallthrough: { variation: 1 } });
      expect(r.fidelity.notes.map((n) => n.message)).toContainEqual(expect.stringMatching(/STALE_NO_RULES/));
    });

    it('stableID rollouts bucket by the device context kind', () => {
      const r = mapGate(args('anon_homepage_variant'));
      expect(r.env.fallthrough.rollout?.contextKind).toBe('device');
      expect(types(r)).toContain('unit_type_kind');
    });

    it('gate holdouts are not carried over (known gap: no note yet)', () => {
      const r = mapGate(args('new_checkout_flow'));
      expect(web.gates.find((g) => g.id === 'new_checkout_flow')!.holdoutIds).toEqual(['checkout_holdout']);
      expect(r.fidelity.notes.some((n) => /holdout/i.test(n.message))).toBe(false);
    });
  });

  describe('operators', () => {
    it('numeric `any` targets become strings (known gap: LD `in` is type-strict)', () => {
      expect(clause(mapGate(args('loyalty_tier_perks')))).toMatchObject({ op: 'in', values: ['2', '3'] });
    });

    it('encoded_any has no equivalent anywhere and is a blocking decision', () => {
      const d = mapGate(args('legacy_partner_allowlist')).unresolved.find((x) => x.type === 'unsupported_condition')!;
      expect(d.title).toMatch(/encoded_any/);
    });

    it('spec-only operators: eq / neq / version_neq / str_starts_with_any / str_ends_with_any', () => {
      const r = mapGate(
        args('gift_card_upsell', {
          entity: withConditions([
            { operator: 'eq', targetValue: 'pro' },
            { operator: 'neq', targetValue: 'trial' },
            { field: 'appVersion', operator: 'version_neq', targetValue: '2.0.0' },
            { operator: 'str_starts_with_any', targetValue: ['Pro'] },
            { operator: 'str_ends_with_any', targetValue: ['Plus'] },
          ]),
        }),
      );
      const cs = r.env.rules[0]!.clauses;
      expect(cs[0]).toMatchObject({ op: 'in', values: ['pro'], negate: false });
      expect(cs[1]).toMatchObject({ op: 'in', values: ['trial'], negate: true });
      expect(cs[2]).toMatchObject({ op: 'semVerEqual', values: ['2.0.0'], negate: true });
      expect(cs[3]).toMatchObject({ op: 'matches', values: ['^[pP][rR][oO]'] });
      expect(cs[4]).toMatchObject({ op: 'matches', values: ['[pP][lL][uU][sS]$'] });
      // neq passes users without the attribute in StatSig; LD never matches them.
      expect(r.unresolved.filter((d) => d.type === 'negated_missing_attribute')).toHaveLength(1);
    });

    it('4-part and prerelease versions pass through unchanged (known gap: not valid LD semver)', () => {
      const r = mapGate(args('gift_card_upsell', { entity: withConditions([{ type: 'app_version', operator: 'version_gte', targetValue: '5.2.0.100' }]) }));
      expect(clause(r)).toMatchObject({ attribute: 'appVersion', op: 'semVerLessThan', values: ['5.2.0.100'], negate: true });
      expect(r.unresolved.map((d) => d.type)).not.toContain('unsupported_condition');
    });
  });

  describe('names, keys and overrides', () => {
    it('a StatSig name with spaces becomes a sanitized LD key, with a note', () => {
      const r = mapGate(args('Holiday Banner 2026'));
      expect(r.flagKey).toBe('Holiday_Banner_2026');
      expect(r.fidelity.notes.map((n) => n.message)).toContainEqual(expect.stringMatching(/differs from the StatSig name/));
    });

    it('a tag LD cannot spell is renamed, with a note', () => {
      const r = mapGate(args('eu_cookie_banner'));
      expect(r.shell.tags).toContain('core');
      expect(r.fidelity.notes.map((n) => n.message)).toContainEqual(expect.stringMatching(/renamed to fit LD's tag format/));
    });

    it('custom-ID overrides on a userID gate ask for a context kind named after the unknown unit type', () => {
      const r = mapGate(args('search_v2'));
      expect(r.env.targets).toContainEqual({ contextKind: 'custom', variation: 0, values: ['acct_3001'] });
      expect(r.unresolved.find((d) => d.type === 'unit_type_kind')?.subject.id).toBe('customID');
    });
  });

  describe('segments', () => {
    const seg = (id: string, env = { statsig: 'production', ld: 'production' }) =>
      mapSegment({ canonical: { snapshot: web }, entity: web.segments.find((s) => s.id === id)!, profile: profileFor(web, MAPPING), resolutions: new Map(), capabilities: CAPS, env, now: NOW });

    it('a segment rule with a pass percentage becomes a weighted rule and needs an acknowledgement', () => {
      const r = seg('churn_risk');
      expect(r.desired?.rules[0]).toMatchObject({ weight: 10_000, rolloutContextKind: 'user' });
      expect(r.unresolved.map((d) => d.type)).toEqual(['partial_rollout_rebucket']);
    });

    it('a disabled segment has no rules, so nobody matches', () => {
      const r = seg('legacy_partners');
      expect(r.desired?.rules).toEqual([]);
      expect(r.fidelity.notes.map((n) => n.message)).toContainEqual(expect.stringMatching(/Disabled in StatSig/));
    });

    it('a gate reference inside a segment is inlined when exact, and skips the segment otherwise', () => {
      expect(seg('staff_or_beta').desired?.rules.map((x) => x.description)).toEqual(['Staff', 'Opted in']);
      expect(seg('early_adopters').skipped).toMatch(/can't be inlined/);
      // The referencing gate maps as "full": only the planner sees the skipped dependency.
      expect(mapGate(args('early_adopter_badge')).fidelity.overall).toBe('full');
    });

    it('an empty ID list is an empty LD segment', () => {
      expect(seg('beta_waitlist').desired?.included).toEqual([]);
    });
  });

  describe('autotunes → multi-armed bandits (PLAN §11; edge cases 11.8–11.15)', () => {
    const at = (id: string, resolutions = new Map<string, Resolution>()) =>
      mapAutotune({ canonical: { snapshot: web }, entity: web.autotunes.find((a) => a.id === id)!, profile: profileFor(web, MAPPING), resolutions, capabilities: CAPS, env: { statsig: 'production', ld: 'production' }, now: NOW });
    const decide = (r: { unresolved: { id: string; type: string; fingerprint: string }[] }, type: string, optionKey: string): Map<string, Resolution> => {
      const d = r.unresolved.find((x) => x.type === type)!;
      return new Map([[d.id, { id: d.id, type: d.type as Resolution['type'], optionKey, scope: 'resource', fingerprint: d.fingerprint, decidedAt: NOW }]]);
    };

    it('11.8: a not-started autotune becomes an off JSON flag, a success metric and a drafted bandit', () => {
      const r = at('hero_image_autotune');
      expect(r.state).toBe('not_started');
      expect(r.skipped).toBeUndefined();
      expect(r.shell.variations.map((v) => v.name)).toEqual(['Lifestyle', 'Product']);
      expect(r.shell.variations[0]!.value).toEqual({ image: 'hero-lifestyle.jpg' });
      expect(r.shell.customProperties['statsig.type']!.value).toEqual(['autotune']);
      expect(r.env).toMatchObject({ on: false, offVariation: 0, fallthrough: { rollout: { contextKind: 'user', variations: [{ variation: 0, weight: 50_000 }, { variation: 1, weight: 50_000 }] } } });
      expect(r.metric).toMatchObject({ key: 'hero_click', kind: 'custom', eventKey: 'hero_click', isNumeric: false, successCriteria: 'HigherThanBaseline' });
      expect(r.bandit).toMatchObject({ key: 'hero_image_autotune', flagKey: 'hero_image_autotune', ruleId: 'fallthrough', metricKey: 'hero_click', randomizationUnit: 'user' });
      expect(r.bandit!.treatments).toEqual([
        { name: 'Lifestyle', baseline: true, allocationPercent: '50', variation: 0 },
        { name: 'Product', baseline: false, allocationPercent: '50', variation: 1 },
      ]);
      expect(r.dependencies).toEqual([{ kind: 'metric', key: 'hero_click', entityId: 'hero_click' }]);
      expect(types(r)).toEqual(['client_side_availability']);
    });

    it('11.8: a running autotune waits by default (autotune_running), or is pre-staged', () => {
      const waiting = at('promo_banner_autotune');
      expect(waiting.state).toBe('running');
      expect(types(waiting)).toContain('autotune_running');
      expect(waiting.skipped).toMatch(/running in StatSig/);
      const staged = at('promo_banner_autotune', decide(waiting, 'autotune_running', 'prestage'));
      expect(staged.skipped).toBeUndefined();
      expect(staged.fidelity.overall).toBe('partial');
      expect(staged.bandit!.treatments).toHaveLength(3);
    });

    it('11.9: arm sizes that sum to 99 are normalized to thousandths summing to 100 000', () => {
      const r = at('promo_banner_autotune', decide(at('promo_banner_autotune'), 'autotune_running', 'prestage'));
      const weights = r.env.fallthrough.rollout!.variations.map((v) => v.weight);
      expect(weights.reduce((n, w) => n + w, 0)).toBe(100_000);
      expect(weights).toEqual([33_334, 33_333, 33_333]);
      expect(r.bandit!.treatments.map((t) => t.allocationPercent)).toEqual(['33.33', '33.33', '33.33']);
      expect(r.fidelity.notes.map((n) => n.message)).toContainEqual(expect.stringMatching(/add up to 99%/));
    });

    it('11.10: a concluded autotune serves the winner at 100% with no bandit', () => {
      const r = at('pricing_page_autotune');
      expect(r.state).toBe('concluded');
      expect(r.env).toMatchObject({ on: true, fallthrough: { variation: 1 } });
      expect(r.bandit).toBeNull();
      expect(r.metric).toBeNull();
      expect(r.fidelity.overall).toBe('full');
    });

    it('11.11: no success event is a blocking missing_metric decision; "flag only" is manual fidelity', () => {
      const r = at('cart_upsell_autotune');
      expect(r.unresolved.map((d) => [d.type, d.severity])).toContainEqual(['missing_metric', 'blocking']);
      expect(r.bandit).toBeNull();
      const flagOnly = at('cart_upsell_autotune', decide(r, 'missing_metric', 'flag_only'));
      expect(flagOnly.fidelity.overall).toBe('manual');
      expect(flagOnly.env.fallthrough.rollout!.variations).toHaveLength(2);
      expect(at('cart_upsell_autotune', decide(r, 'missing_metric', 'skip')).skipped).toMatch(/no success event/);
    });

    it('11.12: variants with identical JSON are merged into one arm (or the item is skipped)', () => {
      const r = at('free_shipping_copy_autotune');
      expect(types(r)).toContain('duplicate_variant_value');
      expect(r.shell.variations.map((v) => v.name)).toEqual(['Short / Short again', 'Long']);
      expect(r.env.fallthrough.rollout!.variations.map((v) => v.weight)).toEqual([66_667, 33_333]);
      expect(r.fidelity.overall).toBe('partial');
      expect(at('free_shipping_copy_autotune', decide(r, 'duplicate_variant_value', 'skip')).skipped).toMatch(/identical values/);
    });

    it('11.13: a companyID autotune randomizes by the company kind and needs a randomization unit', () => {
      const r = at('b2b_pricing_autotune');
      expect(r.bandit!.randomizationUnit).toBe('company');
      expect(r.metric!.analysisUnits).toEqual(['company']);
      expect(r.dependencies.map((d) => `${d.kind}:${d.key}`)).toEqual(['context_kind:company', 'metric:quote_requested', 'randomization_unit:company']);
      expect(types(r)).toContain('unit_type_kind');
    });

    it('is deterministic and fingerprints the arms, event and state', () => {
      const a = at('hero_image_autotune');
      const b = at('hero_image_autotune');
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const changed = mapAutotune({ canonical: { snapshot: web }, entity: { ...web.autotunes.find((x) => x.id === 'hero_image_autotune')!, isStarted: true }, profile: profileFor(web, MAPPING), resolutions: new Map(), capabilities: CAPS, env: { statsig: 'production', ld: 'production' }, now: NOW });
      expect(changed.statsigFingerprint).not.toBe(a.statsigFingerprint);
    });
  });
});
