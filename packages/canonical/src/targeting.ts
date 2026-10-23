import { overridesForEnvironment, resolveRulesForEnvironment, toArray } from './environment.ts';
import { fingerprint, stableStringify } from './hash.ts';
import type { Condition, Config, Gate, Override, Rule, Segment } from './model.ts';

/** Operators whose target is a set of values (order-insensitive). */
const SET_OPERATORS = new Set([
  'any',
  'none',
  'any_case_sensitive',
  'none_case_sensitive',
  'str_contains_any',
  'str_contains_none',
  'str_starts_with_any',
  'str_ends_with_any',
  'array_contains_any',
  'array_contains_none',
  'array_contains_all',
  'not_array_contains_all',
  'encoded_any',
]);

export interface NormalizedCondition {
  type: string;
  operator: string | null;
  targetValue: unknown;
  field?: string;
  customID?: string;
}

export interface NormalizedRule {
  passPercentage: number;
  idType: string;
  conditions: NormalizedCondition[];
  value?: unknown;
  variants?: { passPercentage: number; returnValue: unknown }[];
}

export interface EffectiveTargeting {
  enabled: boolean;
  idType: string;
  defaultValue?: unknown;
  rules: NormalizedRule[];
  overrides: { unitType: string; value: string; ids: string[] }[];
}

/**
 * The targeting that actually applies in one environment, in a comparison-friendly normal form.
 * Source-specific details (rule names and IDs, salts, how environment scoping is encoded) are
 * removed. Used for adapter equivalence (Console API vs spec) and, later, drift fingerprints.
 */
export function effectiveTargeting(entity: Gate | Config | Segment, env: string): EffectiveTargeting {
  const { rules } = resolveRulesForEnvironment(entity.rules, env);
  const overrides = 'overrides' in entity ? overridesForEnvironment(entity.overrides, env) : [];
  return {
    enabled: entity.enabled,
    idType: entity.idType.toLowerCase(),
    ...(entity.kind === 'config' ? { defaultValue: entity.defaultValue } : {}),
    rules: rules.map((r) => normalizeRule(r, entity.kind === 'gate' || entity.kind === 'segment')),
    overrides: normalizeOverrides(overrides),
  };
}

export function targetingFingerprint(entity: Gate | Config | Segment, env: string): string {
  return fingerprint(effectiveTargeting(entity, env));
}

export function normalizeRule(r: Rule, isBoolean: boolean): NormalizedRule {
  const out: NormalizedRule = {
    passPercentage: round(r.passPercentage),
    idType: r.idType.toLowerCase(),
    conditions: r.conditions.map(normalizeCondition),
  };
  if (!isBoolean) {
    if (r.variants?.length) {
      out.variants = r.variants.map((v) => ({ passPercentage: round(v.passPercentage), returnValue: v.returnValue }));
    } else {
      out.value = r.returnValue ?? {};
    }
  }
  return out;
}

export function normalizeCondition(c: Condition): NormalizedCondition {
  const op = c.operator ?? null;
  let targetValue: unknown;
  if (c.type === 'public') {
    targetValue = null;
  } else if (c.type === 'passes_gate' || c.type === 'fails_gate' || c.type === 'passes_segment' || c.type === 'fails_segment') {
    targetValue = sortValues(toArray(c.targetValue).map(String));
  } else if (op !== null && SET_OPERATORS.has(op)) {
    targetValue = sortValues(toArray(c.targetValue));
  } else if (Array.isArray(c.targetValue) && c.targetValue.length === 1) {
    targetValue = c.targetValue[0];
  } else {
    targetValue = c.targetValue ?? null;
  }
  const out: NormalizedCondition = {
    type: c.type,
    // Gate/segment references carry no meaningful operator.
    operator: ['passes_gate', 'fails_gate', 'passes_segment', 'fails_segment', 'public'].includes(c.type) ? null : op,
    targetValue,
  };
  if (c.type === 'custom_field' && c.field) out.field = c.field;
  if (c.type === 'unit_id' && c.customID) out.customID = c.customID.toLowerCase();
  return out;
}

function normalizeOverrides(overrides: Override[]): EffectiveTargeting['overrides'] {
  const groups = new Map<string, { unitType: string; value: string; ids: Set<string> }>();
  for (const o of overrides) {
    const value = o.value.kind === 'gate' ? (o.value.pass ? 'pass' : 'fail') : o.value.kind === 'value' ? `value:${stableStringify(o.value.returnValue)}` : `group:${o.value.groupName ?? o.value.groupId}`;
    const unitType = o.unitType.toLowerCase();
    const key = `${unitType}|${value}`;
    const g = groups.get(key) ?? { unitType, value, ids: new Set<string>() };
    o.ids.forEach((id) => g.ids.add(id));
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ unitType: g.unitType, value: g.value, ids: [...g.ids].sort() }))
    .filter((g) => g.ids.length > 0)
    .sort((a, b) => (a.unitType + a.value).localeCompare(b.unitType + b.value));
}

function sortValues(vs: unknown[]): unknown[] {
  return [...vs].sort((a, b) => String(a).localeCompare(String(b)));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
