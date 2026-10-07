import type { Condition, Override, Rule } from './model.ts';

export type RuleDropReason = 'not_enabled_in_environment' | 'environment_tier_false';

export interface EnvironmentResolution {
  /** Rules that apply in this environment, with statically-true `environment_tier` conditions removed. */
  rules: Rule[];
  dropped: { ruleId: string; reason: RuleDropReason }[];
  /** `environment_tier` conditions whose operator we can't evaluate statically; left in place. */
  unresolved: { ruleId: string; condition: Condition }[];
}

/**
 * PLAN §10.2 step 1: keep rules whose `environments` is null or includes `env`, and resolve every
 * `environment_tier` condition statically. True here → drop the condition; false → drop the rule.
 * StatSig compares environment tiers case-insensitively for `any`/`none` (SDK getFromEnvironment).
 */
export function resolveRulesForEnvironment(rules: Rule[], env: string): EnvironmentResolution {
  const out: EnvironmentResolution = { rules: [], dropped: [], unresolved: [] };
  for (const rule of rules) {
    if (rule.environments !== null && !rule.environments.some((e) => eqi(e, env))) {
      out.dropped.push({ ruleId: rule.id, reason: 'not_enabled_in_environment' });
      continue;
    }
    let ruleFalse = false;
    const kept: Condition[] = [];
    for (const c of rule.conditions) {
      if (c.type !== 'environment_tier') {
        kept.push(c);
        continue;
      }
      const v = evaluateTierCondition(c, env);
      if (v === undefined) {
        out.unresolved.push({ ruleId: rule.id, condition: c });
        kept.push(c);
      } else if (!v) {
        ruleFalse = true;
        break;
      }
    }
    if (ruleFalse) {
      out.dropped.push({ ruleId: rule.id, reason: 'environment_tier_false' });
      continue;
    }
    out.rules.push({ ...rule, environments: null, conditions: kept });
  }
  return out;
}

export function overridesForEnvironment(overrides: Override[], env: string): Override[] {
  return overrides.filter((o) => o.environment === null || eqi(o.environment, env));
}

/** Evaluate an environment_tier condition for a known tier; `undefined` if not statically decidable. */
export function evaluateTierCondition(c: Condition, tier: string): boolean | undefined {
  const targets = toArray(c.targetValue).map((x) => String(x));
  switch (c.operator) {
    case 'any':
      return targets.some((t) => eqi(t, tier));
    case 'none':
      return !targets.some((t) => eqi(t, tier));
    case 'any_case_sensitive':
      return targets.includes(tier);
    case 'none_case_sensitive':
      return !targets.includes(tier);
    case 'eq':
      return c.targetValue === null ? false : targets.some((t) => t === tier);
    case 'neq':
      return c.targetValue === null ? true : !targets.some((t) => t === tier);
    case 'str_contains_any':
      return targets.some((t) => tier.toLowerCase().includes(t.toLowerCase()));
    case 'str_contains_none':
      return !targets.some((t) => tier.toLowerCase().includes(t.toLowerCase()));
    case 'str_starts_with_any':
      return targets.some((t) => tier.toLowerCase().startsWith(t.toLowerCase()));
    case 'str_ends_with_any':
      return targets.some((t) => tier.toLowerCase().endsWith(t.toLowerCase()));
    case 'is_null':
      return false;
    case 'is_not_null':
      return true;
    default:
      return undefined;
  }
}

export function toArray(v: unknown): unknown[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function eqi(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
