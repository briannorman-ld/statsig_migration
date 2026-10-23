/**
 * Lenient Zod schemas for an uploaded config spec (download_config_specs, DCS v1 or v2).
 *
 * Same stance as packages/statsig-client/src/schemas.ts for the Console API: unknown fields are
 * always allowed (`looseObject`), only the fields the normalizer relies on are required, and a
 * mismatch is recorded as a `schema_mismatch` snapshot warning, never thrown. Shapes verified
 * against every fixture under reference/statsig/dcs-fixtures and packages/demo-fixtures.
 */
import { z } from 'zod';

const str = z.string();
const optStr = z.string().nullish();
const optBool = z.boolean().nullish();
const strArr = z.array(z.string());

/** A condition, inline (v1) or looked up in `condition_map` (v2). `type` is the only field every form has. */
export const DcsConditionSchema = z.looseObject({
  type: str,
  operator: optStr,
  targetValue: z.unknown().optional(),
  field: optStr,
  additionalValues: z.record(z.string(), z.unknown()).nullish(),
  idType: optStr,
  isDeviceBased: optBool,
});

/** A rule as it sits in the file: v2 `conditions` are condition_map keys (strings or numbers). */
export const DcsRawRuleSchema = z.looseObject({
  id: str,
  name: optStr,
  passPercentage: z.number(),
  conditions: z.array(z.unknown()).nullish(),
  returnValue: z.unknown().optional(),
  salt: optStr,
  idType: optStr,
  groupName: optStr,
  isExperimentGroup: optBool,
  configDelegate: optStr,
});

/** A gate / dynamic config / layer config entry. `rules` are validated one by one (see normalize.ts). */
export const DcsRawSpecSchema = z.looseObject({
  name: optStr,
  type: optStr,
  salt: optStr,
  enabled: z.boolean(),
  defaultValue: z.unknown().optional(),
  rules: z.array(z.unknown()).nullish(),
  idType: optStr,
  entity: optStr,
  isActive: optBool,
  hasSharedParams: optBool,
  explicitParameters: strArr.nullish(),
  version: z.number().nullish(),
  targetAppIDs: strArr.nullish(),
});

/** A section: v1 is an array of specs, v2 an object keyed by name. */
export const DcsSectionSchema = z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]);

export const DcsConditionMapSchema = z.record(z.string(), z.unknown());
/** v1: layer name → experiment names. */
export const DcsLayersSchema = z.record(z.string(), strArr);
/** v2: experiment name → layer name. */
export const DcsExperimentToLayerSchema = z.record(z.string(), z.string());
/** v1: ID-list name → anything (only the keys are used). */
export const DcsIdListsSchema = z.record(z.string(), z.unknown());

export const DcsParamStoreParameterSchema = z.looseObject({
  name: str,
  ref_type: optStr,
  param_type: optStr,
  value: z.unknown().optional(),
  gate_name: optStr,
  config_name: optStr,
  experiment_name: optStr,
  layer_name: optStr,
  param_name: optStr,
});

export const DcsParamStoreSchema = z.looseObject({
  parameters: z.record(z.string(), DcsParamStoreParameterSchema).nullish(),
  targetAppIDs: strArr.nullish(),
  version: z.number().nullish(),
});

export type DcsRawRule = z.infer<typeof DcsRawRuleSchema>;
export type DcsRawSpec = z.infer<typeof DcsRawSpecSchema>;
export type DcsParamStore = z.infer<typeof DcsParamStoreSchema>;
export type DcsParamStoreParameter = z.infer<typeof DcsParamStoreParameterSchema>;

/** Zod issues as one line, paths and messages only: values may contain PII and never appear. */
export function describeIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`).join('; ');
}
