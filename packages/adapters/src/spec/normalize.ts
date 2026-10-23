import {
  emptySnapshot,
  entityUid,
  SPEC_MISSING_FIELDS,
  type CanonicalSnapshot,
  type Condition,
  type Experiment,
  type ExperimentStatus,
  type FieldGroup,
  type Override,
  type ParamStoreParameter,
  type Rule,
  type RuleVariant,
  type SnapshotWarning,
  type SourceRef,
} from '@sslm/canonical';
import type { z } from 'zod';
import { normalizeDcsCondition, type DcsCondition } from './conditions.ts';
import type { ParsedSpec } from './parse.ts';
import {
  DcsConditionMapSchema,
  DcsConditionSchema,
  DcsExperimentToLayerSchema,
  DcsIdListsSchema,
  DcsLayersSchema,
  DcsParamStoreSchema,
  DcsRawRuleSchema,
  DcsRawSpecSchema,
  DcsSectionSchema,
  describeIssues,
  type DcsParamStoreParameter,
  type DcsRawRule,
  type DcsRawSpec,
} from './schemas.ts';

/** A DCS rule with conditions resolved (v2 condition_map IDs replaced by the conditions). */
export interface DcsRule {
  name: string;
  passPercentage: number;
  conditions: DcsCondition[];
  returnValue?: unknown;
  id: string;
  salt?: string | null;
  idType?: string | null;
  groupName?: string | null;
  isExperimentGroup?: boolean | null;
  configDelegate?: string | null;
}

export interface DcsSpec {
  name: string;
  type: string;
  salt?: string;
  enabled: boolean;
  defaultValue?: unknown;
  rules: DcsRule[];
  idType?: string;
  entity?: string;
  isActive?: boolean;
  hasSharedParams?: boolean;
  explicitParameters?: string[] | null;
  version?: number;
  targetAppIDs?: string[] | null;
}

export interface NormalizeSpecOptions {
  source: SourceRef & { alias: string };
  takenAt: string;
}

const LAYER_ALL = -1;
const BUCKETS = 1000;

/**
 * Config spec (v1 or v2) → canonical (PLAN §4.2). Pure and deterministic.
 *
 * Every section is schema-validated leniently (schemas.ts) the way the Console API path is: a
 * malformed section, entity, rule or condition becomes a `schema_mismatch` warning naming it, the
 * entity it belongs to is skipped (a rule or condition is never dropped on its own, which would
 * widen targeting), and everything that parsed is normalized as usual.
 */
export function normalizeSpec(parsed: ParsedSpec, opts: NormalizeSpecOptions): CanonicalSnapshot {
  const { json } = parsed;
  const { source } = opts;
  const snap = emptySnapshot(source, opts.takenAt);
  const warn = (w: SnapshotWarning) => snap.warnings.push(w);
  snap.completeness = { missing: [...SPEC_MISSING_FIELDS] };
  snap.sourceTime = typeof json.time === 'number' ? json.time : undefined;
  snap.companyId = typeof json.company_id === 'string' ? json.company_id : undefined;
  for (const m of parsed.partialHints) warn({ code: 'partial_spec', message: m });

  const mismatch = (path: string, detail: string) => warn({ code: 'schema_mismatch', path, message: detail });
  /** Parse a top-level section; a wrong shape is one warning and the section counts as absent. */
  const section = <S extends z.ZodType>(name: string, schema: S): z.output<S> | undefined => {
    const value = json[name];
    if (value === undefined || value === null) return undefined;
    const r = schema.safeParse(value);
    if (r.success) return r.data;
    mismatch(name, `Section ignored: ${describeIssues(r.error.issues)}`);
    return undefined;
  };

  const conditionMap = section('condition_map', DcsConditionMapSchema) ?? {};
  const resolveSpecs = (sectionName: string): DcsSpec[] => {
    const sec = section(sectionName, DcsSectionSchema);
    if (!sec) return [];
    const entries: [string | undefined, unknown][] = Array.isArray(sec) ? sec.map((s) => [undefined, s]) : Object.entries(sec);
    const out: DcsSpec[] = [];
    for (const [si, [key, raw]] of entries.entries()) {
      const parsedSpec = DcsRawSpecSchema.safeParse(raw);
      if (!parsedSpec.success) {
        mismatch(`${sectionName}[${key ?? si}]`, `Skipped: ${describeIssues(parsedSpec.error.issues)}`);
        continue;
      }
      const s = parsedSpec.data;
      // v2 keys entities by name; v1 is an array, so the name (when present) beats the index.
      const name = key ?? s.name ?? `spec_${si}`;
      const rules = resolveRules(s, `${sectionName}[${name}]`);
      if (!rules) continue;
      out.push(toDcsSpec(s, s.name ?? name, rules));
    }
    return out;
  };
  /** Rules with v2 condition references resolved; undefined (after a warning) if any rule or condition is malformed. */
  const resolveRules = (s: DcsRawSpec, path: string): DcsRule[] | undefined => {
    const rules: DcsRule[] = [];
    for (const [ri, rawRule] of (s.rules ?? []).entries()) {
      const parsedRule = DcsRawRuleSchema.safeParse(rawRule);
      if (!parsedRule.success) {
        mismatch(path, `Skipped: rules[${ri}]: ${describeIssues(parsedRule.error.issues)}`);
        return undefined;
      }
      const r = parsedRule.data;
      const conditions: DcsCondition[] = [];
      for (const [ci, c] of (r.conditions ?? []).entries()) {
        let resolved: unknown = c;
        if (typeof c === 'string' || typeof c === 'number') {
          resolved = conditionMap[String(c)];
          if (resolved === undefined) {
            warn({ code: 'unresolved_reference', path: `${path}.rules[${ri}].conditions[${ci}]`, message: `condition_map has no entry ${c}` });
            conditions.push({ type: 'unresolved_condition', targetValue: String(c) });
            continue;
          }
        }
        const parsedCond = DcsConditionSchema.safeParse(resolved);
        if (!parsedCond.success) {
          mismatch(path, `Skipped: rules[${ri}].conditions[${ci}]${typeof c === 'string' || typeof c === 'number' ? ` (condition_map[${c}])` : ''}: ${describeIssues(parsedCond.error.issues)}`);
          return undefined;
        }
        conditions.push(parsedCond.data);
      }
      rules.push(toDcsRule(r, conditions));
    }
    return rules;
  };

  const gatesSec = resolveSpecs('feature_gates');
  const configsSec = resolveSpecs('dynamic_configs');
  const layersSec = resolveSpecs('layer_configs');
  const entityOf = new Map<string, string>([...gatesSec, ...configsSec, ...layersSec].map((s) => [s.name, s.entity ?? s.type]));
  const isHoldoutRef = (c: DcsCondition) => c.type === 'pass_gate' && entityOf.get(String(c.targetValue)) === 'holdout';
  // v1 lists ID-list names in `id_lists`; v2 omits the key, so only check when it's present.
  const idLists = section('id_lists', DcsIdListsSchema);
  const idListNames = idLists ? new Set(Object.keys(idLists)) : null;

  const base = (kind: Parameters<typeof entityUid>[1], id: string, missing: FieldGroup[] = []) => ({
    uid: entityUid(source.sourceId, kind, id),
    id,
    name: id,
    source: { sourceId: source.sourceId, sourceKind: source.sourceKind },
    completeness: { missing: [...SPEC_MISSING_FIELDS, ...missing] },
    tags: [],
    archived: false,
  });

  const conv = (conds: DcsCondition[], path: string): Condition[] => conds.map((c, i) => normalizeDcsCondition(c, { warn, path: `${path}.conditions[${i}]` }));
  const toRule = (r: DcsRule, idType: string, path: string, returnValue: unknown): Rule => ({
    id: r.id,
    baseId: r.id.split(':')[0],
    name: r.name,
    passPercentage: r.passPercentage,
    conditions: conv(r.conditions, path),
    environments: null,
    returnValue,
    idType: r.idType ?? idType,
    ...(r.salt ? { salt: r.salt } : {}),
  });

  const inlineTargeting = new Map<string, DcsSpec>();
  const tiers = new Set<string>();
  const unitTypes = new Set<string>();
  const collect = (s: DcsSpec) => {
    if (s.idType) unitTypes.add(s.idType);
    for (const r of s.rules) {
      if (r.idType) unitTypes.add(r.idType);
      for (const c of r.conditions) {
        if (c.idType) unitTypes.add(c.idType);
        if (c.type === 'environment_field' && c.field?.toLowerCase() === 'tier') for (const t of toArr(c.targetValue)) tiers.add(String(t));
      }
    }
  };
  [...gatesSec, ...configsSec, ...layersSec].forEach(collect);

  // --- feature_gates: gates, segments, holdouts ------------------------------------------
  for (const s of gatesSec) {
    const path = `feature_gates[${s.name}]`;
    const entity = s.entity ?? 'feature_gate';
    const idType = s.idType ?? 'userID';
    const targetApps = s.targetAppIDs ?? [];
    if (entity === 'segment') {
      const id = s.name.replace(/^segment:/, '');
      if (id.startsWith('inline_targeting:')) {
        inlineTargeting.set(id.slice('inline_targeting:'.length), s);
        continue;
      }
      const listRule = s.rules.find((r) => r.id === 'id_list');
      if (listRule) {
        const cond = listRule.conditions[0];
        if (cond?.operator === 'in_segment_list') {
          const listName = String(cond.targetValue);
          if (idListNames && !idListNames.has(listName)) warn({ code: 'unresolved_reference', path, message: `ID list "${listName}" is not in id_lists` });
          snap.segments.push({ kind: 'segment', ...base('segment', id, ['idListMembers']), targetApps, version: s.version, segmentType: 'id_list', enabled: s.enabled, idType, rules: [], idList: { hashed: { listName } } });
        } else {
          const ids = toArr(cond?.targetValue).map(String);
          snap.segments.push({ kind: 'segment', ...base('segment', id), targetApps, version: s.version, segmentType: 'id_list', enabled: s.enabled, idType, rules: [], idList: { count: ids.length, ids } });
        }
        continue;
      }
      snap.segments.push({
        kind: 'segment',
        ...base('segment', id),
        targetApps,
        version: s.version,
        segmentType: 'rule_based',
        enabled: s.enabled,
        idType,
        rules: s.rules.map((r, ri) => toRule(r, idType, `${path}.rules[${ri}]`, true)),
      });
      continue;
    }
    const { overrides, rest } = splitOverrides(s.rules, idType, conv, path);
    if (entity === 'holdout') {
      const main = rest[0];
      snap.holdouts.push({
        kind: 'holdout',
        ...base('holdout', s.name),
        targetApps,
        version: s.version,
        enabled: s.enabled,
        idType,
        passPercentage: main?.passPercentage ?? 0,
        isGlobal: false,
        gateIds: [],
        experimentIds: [],
        layerIds: [],
        targetingGateId: null,
      });
      continue;
    }
    if (entity !== 'feature_gate') warn({ code: 'unknown_entity', path, message: `Unknown gate entity "${entity}"; treated as a gate.` });
    const holdoutIds: string[] = [];
    const rules: Rule[] = [];
    for (const [ri, r] of rest.entries()) {
      if (r.conditions.length === 1 && isHoldoutRef(r.conditions[0]!)) {
        holdoutIds.push(String(r.conditions[0]!.targetValue));
        continue;
      }
      rules.push(toRule(r, idType, `${path}.rules[${ri}]`, true));
    }
    snap.gates.push({ kind: 'gate', ...base('gate', s.name), targetApps, version: s.version, enabled: s.enabled, idType, rules, overrides, holdoutIds, ...(s.salt ? { salt: s.salt } : {}) });
  }

  // Holdout membership, from the gates/experiments that reference them.
  const holdoutById = new Map(snap.holdouts.map((h) => [h.id, h]));
  for (const g of snap.gates) for (const h of g.holdoutIds) holdoutById.get(h)?.gateIds.push(g.id);

  // --- dynamic_configs: configs, experiments, autotunes -----------------------------------
  const expToLayer = new Map<string, string>();
  for (const [exp, layer] of Object.entries(section('experiment_to_layer', DcsExperimentToLayerSchema) ?? {})) expToLayer.set(exp, layer);
  for (const [layer, exps] of Object.entries(section('layers', DcsLayersSchema) ?? {})) for (const e of exps) expToLayer.set(e, layer);

  for (const s of configsSec) {
    const path = `dynamic_configs[${s.name}]`;
    const entity = s.entity ?? 'dynamic_config';
    const idType = s.idType ?? 'userID';
    const targetApps = s.targetAppIDs ?? [];
    if (entity === 'experiment') {
      snap.experiments.push(reconstructExperiment(s, { idType, path, conv, isHoldoutRef, inlineTargeting, layerId: expToLayer.get(s.name) ?? null, base, warn, toRule }));
      continue;
    }
    if (entity === 'autotune') {
      const groups = s.rules.filter((r) => r.groupName && !r.id.endsWith('override'));
      snap.autotunes.push({
        kind: 'autotune',
        ...base('autotune', s.name),
        targetApps,
        version: s.version,
        idType,
        variants: groups.map((r) => ({ id: r.id, name: r.groupName ?? r.name, json: r.returnValue })),
        isStarted: s.isActive ?? s.enabled,
        winner: null,
      });
      continue;
    }
    if (entity !== 'dynamic_config') warn({ code: 'unknown_entity', path, message: `Unknown config entity "${entity}"; treated as a dynamic config.` });
    const { overrides, rest } = splitOverrides(s.rules, idType, conv, path, 'config');
    const holdoutIds: string[] = [];
    const plain: DcsRule[] = [];
    for (const r of rest) {
      if (r.conditions.length === 1 && isHoldoutRef(r.conditions[0]!)) holdoutIds.push(String(r.conditions[0]!.targetValue));
      else plain.push(r);
    }
    snap.configs.push({
      kind: 'config',
      ...base('config', s.name),
      targetApps,
      version: s.version,
      enabled: s.enabled,
      idType,
      defaultValue: s.defaultValue ?? {},
      rules: groupVariantRules(plain, idType, path, toRule),
      overrides,
      holdoutIds,
      ...(s.salt ? { salt: s.salt } : {}),
    });
  }
  for (const e of snap.experiments) for (const h of e.holdoutIds) holdoutById.get(h)?.experimentIds.push(e.id);

  // --- layer_configs ---------------------------------------------------------------------
  for (const s of layersSec) {
    const delegated = s.rules.filter((r) => r.configDelegate).map((r) => r.configDelegate as string);
    const fromMap = [...expToLayer.entries()].filter(([, l]) => l === s.name).map(([e]) => e);
    const experimentIds = [...new Set([...fromMap, ...delegated])];
    const defaults = (s.defaultValue ?? {}) as Record<string, unknown>;
    const holdoutIds = s.rules.filter((r) => r.conditions.length === 1 && isHoldoutRef(r.conditions[0]!)).map((r) => String(r.conditions[0]!.targetValue));
    for (const h of holdoutIds) holdoutById.get(h)?.layerIds.push(s.name);
    snap.layers.push({
      kind: 'layer',
      ...base('layer', s.name),
      targetApps: s.targetAppIDs ?? [],
      version: s.version,
      idType: s.idType ?? 'userID',
      isImplicit: false,
      parameters: Object.entries(defaults).map(([name, defaultValue]) => ({ name, type: paramType(defaultValue), defaultValue })),
      experimentIds,
      holdoutIds,
    });
  }

  // --- param stores (v2): each store validated on its own, so one bad store skips only itself -----
  for (const [name, raw] of Object.entries(section('param_stores', DcsConditionMapSchema) ?? {})) {
    const parsedStore = DcsParamStoreSchema.safeParse(raw);
    if (!parsedStore.success) {
      mismatch(`param_stores[${name}]`, `Skipped: ${describeIssues(parsedStore.error.issues)}`);
      continue;
    }
    const store = parsedStore.data;
    snap.paramStores.push({
      kind: 'param_store',
      ...base('param_store', name),
      targetApps: store.targetAppIDs ?? [],
      version: store.version ?? undefined,
      parameters: Object.values(store.parameters ?? {}).map(specParam),
    });
  }

  // --- project-level: inferred environments and unit types ---------------------------------
  const defaultEnv = typeof json.default_environment === 'string' ? json.default_environment : undefined;
  if (defaultEnv) tiers.add(defaultEnv);
  snap.environments = [...tiers].sort().map((name) => ({ name, inferred: true, isProduction: name.toLowerCase() === 'production' }));
  snap.unitTypes = [...unitTypes].sort().map((name) => ({ name }));
  return snap;
}

type Conv = (conds: DcsCondition[], path: string) => Condition[];
type ToRule = (r: DcsRule, idType: string, path: string, returnValue: unknown) => Rule;

/**
 * Override rules: IDs ending in `override` (Rust `Rule::is_override_rule`). Pass/fail comes from
 * passPercentage (100 = pass, 0 = fail); unit type from the ID condition; environment from an
 * `environment_field` condition, or from the `<pass|fail>:<env>:…` rule ID.
 */
function splitOverrides(rules: DcsRule[], idType: string, conv: Conv, path: string, entity: 'gate' | 'config' = 'gate'): { overrides: Override[]; rest: DcsRule[] } {
  const overrides: Override[] = [];
  const rest: DcsRule[] = [];
  for (const [ri, r] of rules.entries()) {
    if (!r.id.endsWith('override')) {
      rest.push(r);
      continue;
    }
    const conds = conv(r.conditions, `${path}.rules[${ri}]`);
    const idCond = conds.find((c) => c.type === 'user_id' || c.type === 'unit_id');
    const envCond = conds.find((c) => c.type === 'environment_tier');
    const unitType = idCond?.type === 'unit_id' ? (idCond.customID ?? idType) : 'userID';
    const idParts = r.id.split(':');
    const envFromId = idParts.length >= 3 && (idParts[0] === 'pass' || idParts[0] === 'fail') && idParts[1] !== 'all' ? idParts[1]! : null;
    const environment = envCond ? String(toArr(envCond.targetValue)[0]) : envFromId;
    const ids = toArr(idCond?.targetValue).map(String);
    // A config's override rule carries the forced value in `returnValue` (a passing gate override carries `true`).
    const value: Override['value'] = r.groupName
      ? { kind: 'group', groupName: r.groupName }
      : entity === 'config' && r.passPercentage >= 100 && r.returnValue !== undefined && r.returnValue !== true
        ? { kind: 'value', returnValue: r.returnValue }
        : { kind: 'gate', pass: r.passPercentage >= 100 };
    overrides.push({ unitType, ids, value, environment });
  }
  return { overrides, rest };
}

/**
 * Config rules with variants. Our demo generator encodes a Console rule with variants as
 * consecutive DCS rules sharing a base ID, each with a trailing `user_bucket lt N` condition
 * (cumulative thresholds out of 1000). UNVERIFIED against a real StatSig export.
 */
function groupVariantRules(rules: DcsRule[], idType: string, path: string, toRule: ToRule): Rule[] {
  const out: Rule[] = [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i]!;
    const bucket = variantBucket(r);
    if (!bucket || !r.groupName) {
      out.push(toRule(r, idType, `${path}.rules[${i}]`, r.returnValue ?? {}));
      continue;
    }
    const baseId = r.id.split(':')[0]!;
    const group: DcsRule[] = [r];
    while (i + 1 < rules.length) {
      const n = rules[i + 1]!;
      const nb = variantBucket(n);
      if (!nb || !n.groupName || n.id.split(':')[0] !== baseId || nb.salt !== bucket.salt) break;
      group.push(n);
      i++;
    }
    let prev = 0;
    const variants: RuleVariant[] = group.map((g) => {
      const t = variantBucket(g)!.threshold;
      const v = { name: g.groupName!, passPercentage: (t - prev) / 10, returnValue: g.returnValue ?? {} };
      prev = t;
      return v;
    });
    const first = { ...r, conditions: r.conditions.slice(0, -1), id: r.id.split(':variant:')[0]! };
    const rule = toRule(first, idType, `${path}.rules[${i}]`, r.returnValue ?? {});
    rule.name = rule.name.split(':variant:')[0]!;
    out.push({ ...rule, variants });
  }
  return out;
}

function variantBucket(r: DcsRule): { threshold: number; salt: unknown } | null {
  const last = r.conditions[r.conditions.length - 1];
  if (!last || last.type !== 'user_bucket' || last.operator !== 'lt' || typeof last.targetValue !== 'number') return null;
  return { threshold: last.targetValue, salt: last.additionalValues?.salt };
}

interface ExpCtx {
  idType: string;
  path: string;
  conv: Conv;
  isHoldoutRef: (c: DcsCondition) => boolean;
  inlineTargeting: Map<string, DcsSpec>;
  layerId: string | null;
  base: (kind: 'experiment', id: string, missing?: FieldGroup[]) => BaseShape;
  warn: (w: SnapshotWarning) => void;
  toRule: ToRule;
}

interface BaseShape {
  uid: string;
  id: string;
  name: string;
  source: SourceRef;
  completeness: { missing: FieldGroup[] };
  tags: string[];
  archived: boolean;
}

/** PLAN §4.2 "Experiment groups" / "Experiment status". */
function reconstructExperiment(s: DcsSpec, ctx: ExpCtx): Experiment {
  const { idType, path } = ctx;
  const { overrides, rest } = splitOverrides(s.rules, idType, ctx.conv, path);
  let status: ExperimentStatus = s.isActive ? 'active' : 'setup';
  let launchedGroup: string | null = null;
  let allocation = 100;
  let targetingGateId: string | null = null;
  let targetingRules: Rule[] = [];
  const holdoutIds: string[] = [];
  const groups: Experiment['groups'] = [];
  let prevBucket = 0;
  let sawMarker = false;
  for (const [ri, r] of rest.entries()) {
    const c0 = r.conditions[0];
    if (r.conditions.length === 1 && c0 && ctx.isHoldoutRef(c0)) {
      holdoutIds.push(String(c0.targetValue));
    } else if (r.id === 'layerAssignment' && c0?.type === 'user_bucket') {
      allocation = allocationFromBuckets(c0);
    } else if (r.id === 'targetingGate' && c0) {
      targetingGateId = String(c0.targetValue);
    } else if (r.id === 'inlineTargetingRules') {
      const inline = ctx.inlineTargeting.get(s.name);
      if (inline) targetingRules = inline.rules.map((ir, i) => ctx.toRule(ir, idType, `${path}.inlineTargeting[${i}]`, true));
    } else if (r.isExperimentGroup) {
      const b = c0?.type === 'user_bucket' && typeof c0.targetValue === 'number' ? c0.targetValue : BUCKETS;
      groups.push({ id: r.id, name: r.groupName ?? r.name, size: (b - prevBucket) / 10, parameterValues: ownParams(r.returnValue, s) });
      prevBucket = b;
    } else if (r.id === 'prestart') {
      status = 'setup';
      sawMarker = true;
    } else if (r.id === 'launchedGroup') {
      status = 'decision_made';
      launchedGroup = r.groupName ?? null;
      sawMarker = true;
      if (launchedGroup && !groups.some((g) => g.name === launchedGroup)) {
        groups.push({ name: launchedGroup, size: 0, parameterValues: ownParams(r.returnValue, s) });
      }
    } else if (r.id === 'abandoned') {
      status = 'abandoned';
      sawMarker = true;
    } else {
      ctx.warn({ code: 'unknown_condition', path: `${path}.rules[${ri}]`, message: `Unrecognized experiment rule "${r.id}"; kept as a targeting rule.` });
      targetingRules.push(ctx.toRule(r, idType, `${path}.rules[${ri}]`, r.returnValue));
    }
  }
  if (!s.isActive && !sawMarker && groups.length === 0) status = 'experiment_stopped';
  // Specs only carry group rules for running experiments.
  const missing: FieldGroup[] = groups.length === 0 || status !== 'active' ? ['hypothesis'] : [];
  return {
    kind: 'experiment',
    ...ctx.base('experiment', s.name, missing),
    targetApps: s.targetAppIDs ?? [],
    version: s.version,
    status,
    idType,
    groups,
    allocation,
    layerId: ctx.layerId,
    targetingGateId,
    launchedGroupId: launchedGroup,
    primaryMetrics: [],
    secondaryMetrics: [],
    overrides,
    targetingRules,
    holdoutIds,
    ...(s.salt ? { salt: s.salt } : {}),
  };
}

/**
 * In a layer, a group's returnValue is the layer defaults merged with the experiment's own
 * parameters; `explicitParameters` names the experiment's own ones (eval_proj_dcs.json).
 */
function ownParams(returnValue: unknown, s: DcsSpec): Record<string, unknown> {
  const v = (returnValue ?? {}) as Record<string, unknown>;
  if (!s.hasSharedParams || !s.explicitParameters) return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => s.explicitParameters!.includes(k)));
}

/**
 * Layer allocation from a `user_bucket` set (v1: array; v2: `{"<n>": true}` object).
 * `none S` → allocated to S; `any S` → allocated to the complement; `{-1}` means 100%.
 */
export function allocationFromBuckets(c: DcsCondition): number {
  const tv = c.targetValue;
  const set = Array.isArray(tv) ? tv.map(Number) : tv && typeof tv === 'object' ? Object.keys(tv).map(Number) : [];
  const inRange = new Set(set.filter((n) => n !== LAYER_ALL && n >= 0 && n < BUCKETS));
  const allocated = c.operator === 'none' ? inRange.size : BUCKETS - inRange.size;
  return Math.round((allocated / BUCKETS) * 1000) / 10;
}

function specParam(p: DcsParamStoreParameter): ParamStoreParameter {
  const refType = p.ref_type ?? 'static';
  const ref =
    refType === 'gate' ? { kind: 'gate' as const, id: String(p.gate_name) }
    : refType === 'dynamic_config' ? { kind: 'config' as const, id: String(p.config_name), param: String(p.param_name) }
    : refType === 'experiment' ? { kind: 'experiment' as const, id: String(p.experiment_name), param: String(p.param_name) }
    : refType === 'layer' ? { kind: 'layer' as const, id: String(p.layer_name), param: String(p.param_name) }
    : undefined;
  return { name: p.name, refType, paramType: p.param_type ?? 'unknown', ...(refType === 'static' ? { value: p.value } : {}), ...(ref ? { ref } : {}), raw: p };
}

/** A validated file entry → the normalizer's spec shape (nulls become absent, per exactOptionalPropertyTypes). */
function toDcsSpec(s: DcsRawSpec, name: string, rules: DcsRule[]): DcsSpec {
  return {
    name,
    type: s.type ?? s.entity ?? 'unknown',
    enabled: s.enabled,
    rules,
    ...(s.salt ? { salt: s.salt } : {}),
    ...(s.defaultValue !== undefined ? { defaultValue: s.defaultValue } : {}),
    ...(s.idType ? { idType: s.idType } : {}),
    ...(s.entity ? { entity: s.entity } : {}),
    ...(s.isActive != null ? { isActive: s.isActive } : {}),
    ...(s.hasSharedParams != null ? { hasSharedParams: s.hasSharedParams } : {}),
    ...(s.explicitParameters !== undefined ? { explicitParameters: s.explicitParameters } : {}),
    ...(s.version != null ? { version: s.version } : {}),
    ...(s.targetAppIDs !== undefined ? { targetAppIDs: s.targetAppIDs } : {}),
  };
}

function toDcsRule(r: DcsRawRule, conditions: DcsCondition[]): DcsRule {
  return {
    id: r.id,
    name: r.name ?? r.id,
    passPercentage: r.passPercentage,
    conditions,
    returnValue: r.returnValue,
    ...(r.salt !== undefined ? { salt: r.salt } : {}),
    ...(r.idType !== undefined ? { idType: r.idType } : {}),
    ...(r.groupName !== undefined ? { groupName: r.groupName } : {}),
    ...(r.isExperimentGroup !== undefined ? { isExperimentGroup: r.isExperimentGroup } : {}),
    ...(r.configDelegate !== undefined ? { configDelegate: r.configDelegate } : {}),
  };
}

function paramType(v: unknown): 'string' | 'number' | 'boolean' | 'object' | 'array' {
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  return t === 'string' || t === 'number' || t === 'boolean' ? t : 'object';
}

function toArr(v: unknown): unknown[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}
