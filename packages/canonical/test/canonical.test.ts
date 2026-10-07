import { describe, expect, it } from 'vitest';
import {
  effectiveTargeting,
  emptySnapshot,
  entityUid,
  fingerprint,
  matchAcrossSources,
  resolveRulesForEnvironment,
  stableStringify,
  type Condition,
  type Gate,
  type Rule,
} from '../src/index.ts';

const cond = (c: Partial<Condition> & Pick<Condition, 'type'>): Condition => ({ operator: null, targetValue: null, raw: c, ...c });
const rule = (id: string, conditions: Condition[], extra: Partial<Rule> = {}): Rule => ({
  id,
  name: id,
  passPercentage: 100,
  conditions,
  environments: null,
  idType: 'userID',
  ...extra,
});

function gate(id: string, sourceId: string, rules: Rule[]): Gate {
  return {
    kind: 'gate',
    uid: entityUid(sourceId, 'gate', id),
    id,
    name: id,
    source: { sourceId, sourceKind: 'console_api' },
    completeness: { missing: [] },
    tags: [],
    archived: false,
    targetApps: [],
    enabled: true,
    idType: 'userID',
    rules,
    overrides: [],
    holdoutIds: [],
  };
}

describe('stableStringify / fingerprint', () => {
  it('is key-order independent', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
    expect(fingerprint({ x: [1, 2] })).not.toBe(fingerprint({ x: [2, 1] }));
    expect(fingerprint('a')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('resolveRulesForEnvironment (PLAN §10.2 step 1)', () => {
  const rules = [
    rule('prod-only', [cond({ type: 'email', operator: 'any', targetValue: ['a@x.com'] })], { environments: ['production'] }),
    rule('tier-staging', [cond({ type: 'environment_tier', operator: 'any', targetValue: ['Staging'] }), cond({ type: 'public' })]),
    rule('tier-not-dev', [cond({ type: 'environment_tier', operator: 'none', targetValue: ['development'] })]),
    rule('weird-op', [cond({ type: 'environment_tier', operator: 'version_gt', targetValue: '1' })]),
  ];

  it('drops rules not enabled in the environment and statically resolves tiers', () => {
    const dev = resolveRulesForEnvironment(rules, 'development');
    expect(dev.rules.map((r) => r.id)).toEqual(['weird-op']);
    expect(dev.dropped).toEqual([
      { ruleId: 'prod-only', reason: 'not_enabled_in_environment' },
      { ruleId: 'tier-staging', reason: 'environment_tier_false' },
      { ruleId: 'tier-not-dev', reason: 'environment_tier_false' },
    ]);
    expect(dev.unresolved).toHaveLength(1);

    const staging = resolveRulesForEnvironment(rules, 'staging');
    expect(staging.rules.map((r) => r.id)).toEqual(['tier-staging', 'tier-not-dev', 'weird-op']);
    // True tier conditions are removed, others kept.
    expect(staging.rules[0]!.conditions.map((c) => c.type)).toEqual(['public']);
    expect(staging.rules[1]!.conditions).toEqual([]);

    const prod = resolveRulesForEnvironment(rules, 'PRODUCTION');
    expect(prod.rules.map((r) => r.id)).toEqual(['prod-only', 'tier-not-dev', 'weird-op']);
  });
});

describe('effectiveTargeting', () => {
  it('treats Console `environments` and spec `environment_tier` encodings as equivalent', () => {
    const emailCond = cond({ type: 'email', operator: 'any', targetValue: ['b@x.com', 'a@x.com'] });
    const consoleGate = gate('g', 'web', [rule('r1', [emailCond], { environments: ['staging'], name: 'Beta testers' })]);
    const specGate = gate('g', 'web-spec', [
      rule('7xYz:100.00:1', [cond({ type: 'environment_tier', operator: 'any', targetValue: ['staging'] }), { ...emailCond, targetValue: ['a@x.com', 'b@x.com'] }]),
    ]);
    for (const env of ['development', 'staging', 'production']) {
      expect(effectiveTargeting(specGate, env)).toEqual(effectiveTargeting(consoleGate, env));
    }
    expect(effectiveTargeting(consoleGate, 'production').rules).toEqual([]);
  });

  it('unwraps single-element arrays for scalar operators', () => {
    const a = gate('g', 's', [rule('r', [cond({ type: 'app_version', operator: 'version_gte', targetValue: ['1.2.0'] })])]);
    const b = gate('g', 's', [rule('r', [cond({ type: 'app_version', operator: 'version_gte', targetValue: '1.2.0' })])]);
    expect(effectiveTargeting(a, 'production')).toEqual(effectiveTargeting(b, 'production'));
  });
});

describe('matchAcrossSources (N-source)', () => {
  it('groups entities by kind and id across sources', () => {
    const web = emptySnapshot({ sourceId: 'web', sourceKind: 'console_api', alias: 'web' }, '2026-01-01T00:00:00Z');
    const mobile = emptySnapshot({ sourceId: 'mobile', sourceKind: 'console_api', alias: 'mobile' }, '2026-01-01T00:00:00Z');
    web.gates.push(gate('shared', 'web', []), gate('web_only', 'web', []));
    mobile.gates.push(gate('shared', 'mobile', []));
    const m = matchAcrossSources([web, mobile], 'gate');
    expect(m.map((x) => [x.id, Object.keys(x.bySource)])).toEqual([
      ['shared', ['web', 'mobile']],
      ['web_only', ['web']],
    ]);
  });
});
