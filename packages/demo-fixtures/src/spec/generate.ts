/**
 * Generates StatSig config-spec (download_config_specs) files, v1 and v2, from a Console API
 * dataset, for the spec-only demo path and the adapter-equivalence test (PLAN §19.1, §16).
 *
 * This is deliberately an independent implementation of Console → DCS (it does not reuse the
 * adapters' DCS → canonical tables), so the equivalence test cross-checks two implementations.
 * Encodings follow the real SDK fixtures in reference/statsig/dcs-fixtures where they show the
 * form. Where no fixture shows it, the choice is marked UNVERIFIED:
 *   - config rule variants (cumulative `user_bucket lt` split per variant, sharing the rule salt)
 *   - environment-scoped overrides (`pass:<env>:id_override` + an environment_field condition)
 *   - the size above which ID lists move from inline to get_id_lists (assumed 1000)
 *   - `javascript` / `url` / `experiment_group` / `target_app` conditions (emitted as-is)
 */
import { expandIdList, type Json, type JsonObject } from '../console/builders.ts';
import type { ConsoleProjectDataset } from '../console/dataset.ts';
import { pseudoId } from '../ids.ts';
import { pseudoUuid } from '../console/builders.ts';
import { statsigIdListHash } from './sha256.ts';

export const INLINE_ID_LIST_MAX = 1000;
const BUCKETS = 1000;

type DcsCondition = { type: string; targetValue: Json; operator: string | null; field: string | null; additionalValues: JsonObject | null; idType: string };
type DcsRule = JsonObject & { conditions: DcsCondition[] };
type DcsSpec = JsonObject & { name: string; rules: DcsRule[] };

export interface GeneratedSpecFiles {
  /** The download_config_specs body. */
  spec: JsonObject;
  /** get_id_lists manifest (only lists too large to inline). */
  idListManifest: JsonObject;
  /** Hashed ID-list files, `+hash` per line, keyed by list name. */
  idListFiles: Record<string, string>;
}

export function generateConfigSpec(d: ConsoleProjectDataset, version: 1 | 2): GeneratedSpecFiles {
  const project = String(d.project.name);
  const salt = (key: string) => pseudoUuid(`${project}/salt/${key}`);
  const gates: DcsSpec[] = [];
  const configs: DcsSpec[] = [];
  const layerSpecs: DcsSpec[] = [];
  const idListManifest: JsonObject = {};
  const idListFiles: Record<string, string> = {};
  const holdoutIds = new Set(d.holdouts.map((h) => String(h.id)));

  // --- Gates ---------------------------------------------------------------------------------
  const gateOverrides = new Map(((d.overrides.gates ?? []) as JsonObject[]).map((o) => [String(o.id), o]));
  for (const g of d.gates) {
    if (g.status === 'Archived') continue; // archived entities are not in specs (PLAN §18 item 4)
    const idType = String(g.idType ?? 'userID');
    const rules: DcsRule[] = [
      ...gateOverrideRules(gateOverrides.get(String(g.id)), idType),
      ...((g.holdoutIDs ?? []) as string[]).filter((h) => holdoutIds.has(h)).map((h) => holdoutRule(project, h, idType, 0, true)),
      ...(g.rules as JsonObject[]).map((r) => consoleRule(r, idType, true)),
    ];
    gates.push(spec(String(g.id), 'feature_gate', 'feature_gate', salt(`gate/${g.id}`), g.isEnabled as boolean, false, rules, idType, g.version));
  }

  // --- Segments --------------------------------------------------------------------------------
  for (const s of d.segments) {
    const idType = String(s.idType ?? 'userID');
    const name = `segment:${s.id}`;
    if (s.type === 'id_list') {
      const seed = d.idLists[String(s.id)];
      const ids = seed ? expandIdList(seed) : [];
      let cond: DcsCondition;
      if (ids.length <= INLINE_ID_LIST_MAX) {
        cond = c('unit_id', ids, 'any', idType, { custom_id: idType }, idType);
      } else {
        cond = c('unit_id', String(s.id), 'in_segment_list', null, {}, idType);
        const file = ids.map((id) => `+${statsigIdListHash(id)}\n`).join('');
        idListFiles[String(s.id)] = file;
        idListManifest[String(s.id)] = { name: String(s.id), size: file.length, url: `URL_REPLACE/${s.id}`, creationTime: d.now - 30 * 86_400_000, fileID: pseudoId(`${project}/idlist/${s.id}`) };
      }
      gates.push(spec(name, 'feature_gate', 'segment', salt(`segment/${s.id}`), s.isEnabled as boolean, false, [{ name: 'id_list', passPercentage: 100, conditions: [cond], returnValue: true, id: 'id_list', salt: '', idType }], idType, s.version));
    } else {
      const rules = ((s.rules ?? []) as JsonObject[]).map((r) => consoleRule(r, idType, true));
      gates.push(spec(name, 'feature_gate', 'segment', salt(`segment/${s.id}`), s.isEnabled as boolean, false, rules, idType, s.version));
    }
  }

  // --- Holdouts ----------------------------------------------------------------------------
  for (const h of d.holdouts) {
    const ruleId = `${pseudoId(`${project}/holdout/${h.id}`)}:${Number(h.passPercentage).toFixed(2)}:1`;
    gates.push(
      spec(String(h.id), 'feature_gate', 'holdout', salt(`holdout/${h.id}`), h.isEnabled as boolean, false, [
        { name: ruleId, passPercentage: h.passPercentage as number, conditions: [c('public', null, null, null, null, 'userID')], returnValue: true, id: ruleId, salt: ruleId.split(':')[0]!, idType: 'userID' },
      ], 'userID', h.version),
    );
  }

  // --- Dynamic configs ---------------------------------------------------------------------
  for (const cfg of d.dynamicConfigs) {
    if (cfg.status === 'Archived') continue;
    const idType = String(cfg.idType ?? 'userID');
    const rules: DcsRule[] = [
      ...((cfg.holdoutIDs ?? []) as string[]).filter((h) => holdoutIds.has(h)).map((h) => holdoutRule(project, h, idType, 100, cfg.defaultValue as Json)),
      ...(cfg.rules as JsonObject[]).flatMap((r) => configRules(r, idType)),
    ];
    configs.push(spec(String(cfg.id), 'dynamic_config', 'dynamic_config', salt(`config/${cfg.id}`), cfg.isEnabled as boolean, cfg.defaultValue as Json, rules, idType, cfg.version));
  }

  // --- Layers & experiments ---------------------------------------------------------------
  const experimentToLayer: Record<string, string> = {};
  const layerById = new Map(d.layers.map((l) => [String(l.id), l]));
  const layerOffsets = new Map<string, number>();
  const expOverrides = new Map(((d.overrides.experiments ?? []) as JsonObject[]).map((o) => [String(o.id), o]));
  for (const e of d.experiments) {
    if (e.status === 'archived') continue;
    const id = String(e.id);
    const idType = String(e.idType ?? 'userID');
    const layerId = (e.layerID as string | null) ?? null;
    const layer = layerId ? layerById.get(layerId) : undefined;
    const layerDefaults: JsonObject = layer ? Object.fromEntries(((layer.parameters ?? []) as JsonObject[]).map((p) => [String(p.name), p.defaultValue as Json])) : {};
    const groups = e.groups as JsonObject[];
    const groupName = (gid: unknown) => groups.find((g) => g.id === gid)?.name as string | undefined;
    const expSalt = String(e.salt ?? salt(`experiment/${id}`));
    const layerSalt = salt(`layer/${layerId ?? `implicit:${id}`}`);

    // Bucket range in the layer: experiments in the same layer get disjoint ranges.
    const offset = layerOffsets.get(layerId ?? id) ?? 0;
    const size = Math.round((Number(e.allocation) / 100) * BUCKETS);
    layerOffsets.set(layerId ?? id, offset + size);
    const allocated = Array.from({ length: size }, (_, i) => offset + i);
    const bucketSet = (nums: number[]): Json => (version === 2 ? Object.fromEntries(nums.map((n) => [String(n), true])) : nums);

    const rules: DcsRule[] = [];
    for (const u of ((expOverrides.get(id)?.userIDOverrides ?? []) as JsonObject[])) {
      const gName = groupName(u.groupID) ?? '';
      const unitType = String(u.unitType ?? idType);
      const group = groups.find((g) => g.name === gName);
      rules.push({ name: `${u.groupID}:${unitType}:id_override`, groupName: gName, passPercentage: 100, conditions: [idCondition(unitType, u.ids as string[])], returnValue: (group?.parameterValues ?? {}) as Json, id: `${u.groupID}:${unitType}:id_override`, salt: '', idType });
    }
    for (const h of ((e.holdoutIDs ?? []) as string[]).filter((x) => holdoutIds.has(x))) rules.push(holdoutRule(project, h, idType, 100, layerDefaults));
    const full = size >= BUCKETS;
    rules.push({
      name: 'layerAssignment',
      passPercentage: 100,
      conditions: [c('user_bucket', full ? bucketSet([-1]) : bucketSet(allocated), full ? 'any' : 'none', null, { salt: layerSalt }, idType)],
      returnValue: layerDefaults,
      id: 'layerAssignment',
      salt: '',
      idType,
    });
    if (e.targetingGateID) {
      rules.push({ name: 'targetingGate', passPercentage: 100, conditions: [c('fail_gate', String(e.targetingGateID), null, null, {}, idType)], returnValue: layerDefaults, id: 'targetingGate', salt: '', idType });
    }
    const status = String(e.status);
    if (status === 'active') {
      let cum = 0;
      for (const g of groups) {
        cum += Math.round(Number(g.size) * 10);
        rules.push({ name: String(g.id), groupName: String(g.name), passPercentage: 100, conditions: [c('user_bucket', Math.min(cum, BUCKETS), 'lt', null, { salt: expSalt }, idType)], returnValue: { ...layerDefaults, ...(g.parameterValues as JsonObject) }, id: String(g.id), salt: String(g.id), idType, isExperimentGroup: true });
      }
    } else if (status === 'decision_made') {
      const shipped = groups.find((g) => g.id === e.launchedGroupID);
      rules.push({ name: 'launchedGroup', groupName: String(shipped?.name ?? ''), passPercentage: 100, conditions: [c('public', null, null, null, null, idType)], returnValue: { ...layerDefaults, ...((shipped?.parameterValues ?? {}) as JsonObject) }, id: 'launchedGroup', salt: '', idType });
    } else if (status === 'abandoned') {
      rules.push({ name: 'abandoned', passPercentage: 100, conditions: [c('public', null, null, null, null, idType)], returnValue: layerDefaults, id: 'abandoned', salt: '', idType });
    } else {
      rules.push({ name: 'prestart', passPercentage: 100, conditions: [c('public', null, null, null, null, idType)], returnValue: layerDefaults, id: 'prestart', salt: '', idType });
    }
    const s = spec(id, 'dynamic_config', 'experiment', expSalt, true, layerDefaults, rules, idType, e.version);
    s.isActive = status === 'active';
    s.hasSharedParams = layer != null && !layer.isImplicitLayer;
    if (s.hasSharedParams) s.explicitParameters = Object.keys((groups[0]?.parameterValues ?? {}) as JsonObject);
    configs.push(s);
    if (layerId) experimentToLayer[id] = layerId;
  }
  for (const l of d.layers) {
    const id = String(l.id);
    const defaults: JsonObject = Object.fromEntries(((l.parameters ?? []) as JsonObject[]).map((p) => [String(p.name), p.defaultValue as Json]));
    const exps = d.experiments.filter((e) => e.layerID === id && e.status !== 'archived');
    let offset = 0;
    const rules: DcsRule[] = exps.map((e) => {
      const size = Math.round((Number(e.allocation) / 100) * BUCKETS);
      const nums = Array.from({ length: size }, (_, i) => offset + i);
      offset += size;
      const set: Json = version === 2 ? Object.fromEntries(nums.map((n) => [String(n), true])) : nums;
      return { name: 'experimentAssignment', passPercentage: 100, conditions: [c('user_bucket', set, 'any', null, { salt: salt(`layer/${id}`) }, 'userID')], returnValue: defaults, id: 'experimentAssignment', salt: '', idType: 'userID', configDelegate: String(e.id) };
    });
    layerSpecs.push(spec(id, 'dynamic_config', 'layer', salt(`layer/${id}`), true, defaults, rules, String(l.idType ?? 'userID'), l.version));
  }

  // --- Autotunes ---------------------------------------------------------------------------
  for (const a of d.autotunes) {
    const idType = String(a.idType ?? 'userID');
    const atSalt = salt(`autotune/${a.id}`);
    const rules: DcsRule[] = (a.variants as JsonObject[]).map((v) => {
      const rid = pseudoId(`${project}/autotune/${a.id}/${v.id}`);
      return { name: rid, groupName: String(v.name), passPercentage: 100, conditions: [c('user_bucket', BUCKETS, 'lt', null, { salt: atSalt }, idType)], returnValue: v.json as Json, id: rid, salt: rid, idType };
    });
    const s = spec(String(a.id), 'dynamic_config', 'autotune', atSalt, true, {}, rules, idType, a.version);
    s.isActive = a.isStarted as boolean;
    configs.push(s);
  }

  // --- Assemble --------------------------------------------------------------------------
  const company = String(d.company.companyID);
  if (version === 1) {
    const layersV1: Record<string, string[]> = {};
    for (const [e, l] of Object.entries(experimentToLayer)) (layersV1[l] ??= []).push(e);
    return {
      spec: {
        dynamic_configs: configs,
        feature_gates: gates,
        layers: layersV1,
        layer_configs: layerSpecs,
        has_updates: true,
        time: d.now,
        company_id: company,
        id_lists: Object.fromEntries(Object.keys(idListManifest).map((k) => [k, true])),
      },
      idListManifest,
      idListFiles,
    };
  }
  const conditionMap: Record<string, Json> = {};
  const intern = (specs: DcsSpec[]): JsonObject =>
    Object.fromEntries(
      specs.map((s) => {
        const { name, ...rest } = s;
        const rules = s.rules.map((r) => ({
          ...r,
          conditions: r.conditions.map((cond) => {
            const key = conditionKey(cond);
            conditionMap[key] = cond as unknown as Json;
            return key;
          }),
        }));
        return [name, { ...rest, rules } as Json];
      }),
    );
  return {
    spec: {
      dynamic_configs: intern(configs),
      feature_gates: intern(gates),
      experiment_to_layer: experimentToLayer,
      layer_configs: intern(layerSpecs),
      has_updates: true,
      time: d.now,
      company_id: company,
      condition_map: conditionMap,
      response_format: 'dcs-v2',
      param_stores: Object.fromEntries(
        d.paramStores.map((p) => [
          String(p.name),
          { parameters: Object.fromEntries((p.parameters as JsonObject[]).map((x) => [String(x.name), x])), targetAppIDs: [], version: 1 },
        ]),
      ),
      default_environment: null,
    },
    idListManifest,
    idListFiles,
  };

  // ------------------------------------------------------------------------------------------
  function consoleRule(r: JsonObject, idType: string, returnValue: Json): DcsRule {
    const conds = (r.conditions as JsonObject[]).map((x) => consoleCondition(x, idType));
    const envs = r.environments as string[] | null;
    if (envs) conds.unshift(c('environment_field', envs, 'any', 'tier', {}, idType));
    return { name: String(r.id), passPercentage: r.passPercentage as number, conditions: conds, returnValue, id: String(r.id), salt: String(r.baseID ?? r.id), idType };
  }

  function configRules(r: JsonObject, idType: string): DcsRule[] {
    const variants = r.variants as JsonObject[] | undefined;
    if (!variants?.length) return [consoleRule(r, idType, (r.returnValue ?? {}) as Json)];
    const base = consoleRule(r, idType, {});
    let cum = 0;
    return variants.map((v, i) => {
      cum += Math.round(Number(v.passPercentage) * 10);
      const id = `${r.id}:variant:${i}`;
      return { ...base, name: id, id, groupName: String(v.name), returnValue: v.returnValue as Json, conditions: [...base.conditions, c('user_bucket', Math.min(cum, BUCKETS), 'lt', null, { salt: String(r.baseID) }, idType)] };
    });
  }

  function gateOverrideRules(o: JsonObject | undefined, idType: string): DcsRule[] {
    if (!o) return [];
    const out: DcsRule[] = [];
    const push = (pass: boolean, env: string | null, unitType: string, ids: string[] | undefined, custom: boolean) => {
      if (!ids?.length) return;
      const id = `${pass ? 'pass' : 'fail'}:${env ?? 'all'}:${custom ? `${unitType}:` : ''}id_override`;
      const conds = [idCondition(unitType, ids)];
      if (env) conds.unshift(c('environment_field', [env], 'any', 'tier', {}, idType));
      out.push({ name: id, passPercentage: pass ? 100 : 0, conditions: conds, returnValue: true, id, salt: '', idType: unitType });
    };
    push(true, null, 'userID', o.passingUserIDs as string[], false);
    push(false, null, 'userID', o.failingUserIDs as string[], false);
    const customType = idType.toLowerCase() === 'userid' ? 'customID' : idType;
    push(true, null, customType, o.passingCustomIDs as string[], true);
    push(false, null, customType, o.failingCustomIDs as string[], true);
    for (const e of (o.environmentOverrides ?? []) as JsonObject[]) {
      const unitType = String(e.unitID ?? idType);
      push(true, (e.environment as string | null) ?? null, unitType, e.passingIDs as string[], unitType.toLowerCase() !== 'userid');
      push(false, (e.environment as string | null) ?? null, unitType, e.failingIDs as string[], unitType.toLowerCase() !== 'userid');
    }
    return out;
  }
}

function holdoutRule(project: string, holdoutId: string, idType: string, passPercentage: number, returnValue: Json): DcsRule {
  const id = pseudoId(`${project}/holdout-rule/${holdoutId}`);
  return { name: id, passPercentage, conditions: [c('pass_gate', holdoutId, 'any', null, null, idType)], returnValue, id, salt: '', idType };
}

function idCondition(unitType: string, ids: string[]): DcsCondition {
  return unitType.toLowerCase() === 'userid'
    ? c('user_field', ids, 'any', 'userID', {}, 'userID')
    : c('unit_id', ids, 'any', null, { custom_id: unitType }, unitType);
}

/** Console condition → DCS condition (PLAN §4.2 table, inverted). */
function consoleCondition(x: JsonObject, idType: string): DcsCondition {
  const op = (x.operator as string | undefined) ?? null;
  const tv = (x.targetValue ?? null) as Json;
  const opTv = (): [string | null, Json] => (op === 'is_null' ? ['eq', null] : op === 'is_not_null' ? ['neq', null] : [op, tv]);
  const [o, t] = opTv();
  const userField = (field: string) => c('user_field', t, o, field, {}, idType);
  switch (x.type) {
    case 'public':
      return c('public', null, null, null, null, idType);
    case 'user_id':
      return userField('userID');
    case 'email':
      return userField('email');
    case 'ip_address':
      return userField('ip');
    case 'locale':
      return userField('locale');
    case 'app_version':
      return userField('appVersion');
    case 'user_agent':
      return userField('userAgent');
    case 'device_model':
      return userField('device_model');
    case 'custom_field':
      return userField(String(x.field));
    case 'country':
      return c('ip_based', t, o, 'country', {}, idType);
    case 'browser_name':
    case 'browser_version':
    case 'os_name':
    case 'os_version':
      return c('ua_based', t, o, String(x.type), {}, idType);
    case 'environment_tier':
      return c('environment_field', t, o, 'tier', {}, idType);
    case 'passes_gate':
    case 'fails_gate': {
      const names = Array.isArray(tv) ? tv.map(String) : [String(tv)];
      const pass = x.type === 'passes_gate';
      return names.length > 1 ? c(pass ? 'multi_pass_gate' : 'multi_fail_gate', names, null, null, {}, idType) : c(pass ? 'pass_gate' : 'fail_gate', names[0]!, null, null, {}, idType);
    }
    case 'passes_segment':
    case 'fails_segment': {
      const name = Array.isArray(tv) ? String(tv[0]) : String(tv);
      return c(x.type === 'passes_segment' ? 'pass_gate' : 'fail_gate', `segment:${name}`, null, null, {}, idType);
    }
    case 'time':
      return c('current_time', t, o, null, {}, idType);
    case 'unit_id': {
      const custom = String(x.customID ?? idType);
      return c('unit_id', t, o, null, { custom_id: custom }, custom);
    }
    default:
      // target_app, javascript, url, experiment_group: no DCS form shown in any fixture.
      return c(String(x.type), t, o, (x.field as string | undefined) ?? null, {}, idType);
  }
}

function c(type: string, targetValue: Json, operator: string | null, field: string | null, additionalValues: JsonObject | null, idType: string): DcsCondition {
  return { type, targetValue, operator, field, additionalValues, idType };
}

function spec(name: string, type: string, entity: string, salt: string, enabled: boolean, defaultValue: Json, rules: DcsRule[], idType: string, version: Json | undefined): DcsSpec {
  return { name, type, salt, enabled, defaultValue, rules, idType, entity, version: (version ?? 1) as Json };
}

/** Numeric-string key like real condition_map IDs: 32-bit FNV-1a of the condition JSON. */
function conditionKey(cond: DcsCondition): string {
  const s = JSON.stringify(cond);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return String(h);
}
