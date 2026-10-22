/**
 * Lenient Zod schemas for the LD REST API responses we read. Field names come from
 * reference/launchdarkly/openapi.json. Unknown fields pass through.
 */
import { z } from 'zod';

const optStr = z.string().nullish();
const optBool = z.boolean().nullish();
const optNum = z.number().nullish();

export const CallerIdentitySchema = z.looseObject({
  accountId: optStr,
  environmentId: optStr,
  projectId: optStr,
  environmentName: optStr,
  projectName: optStr,
  authKind: optStr,
  tokenKind: optStr,
  clientId: optStr,
  tokenName: optStr,
  tokenId: optStr,
  memberId: optStr,
  serviceToken: optBool,
  scopes: z.array(z.string()).nullish(),
});

/** `token` holds the last four characters on reads; we drop it anyway. */
export const TokenSchema = z
  .looseObject({
    _id: z.string(),
    name: optStr,
    role: optStr,
    customRoleIds: z.array(z.string()).nullish(),
    inlineRole: z.array(z.unknown()).nullish(),
    serviceToken: optBool,
    defaultApiVersion: optNum,
    expiry: optNum,
    token: z.unknown().optional(),
  })
  .transform(({ token: _drop, ...rest }) => rest);

const AccessEntry = z.looseObject({ action: z.string(), reason: z.unknown().optional() });
export const AccessSchema = z.looseObject({ allowed: z.array(AccessEntry).nullish(), denied: z.array(AccessEntry).nullish() });

const ApprovalSettings = z.looseObject({ required: optBool, minNumApprovals: optNum, serviceKind: optStr, requiredApprovalTags: z.array(z.string()).nullish() });

/**
 * `apiKey` (server SDK key) and `mobileKey` are secrets the app has no use for; they are
 * stripped at the schema boundary so they never enter app state, IndexedDB or logs.
 */
export const EnvironmentSchema = z
  .looseObject({
    _id: z.string(),
    key: z.string(),
    name: z.string(),
    color: optStr,
    tags: z.array(z.string()).nullish(),
    critical: optBool,
    requireComments: optBool,
    confirmChanges: optBool,
    _access: AccessSchema.nullish(),
    approvalSettings: ApprovalSettings.nullish(),
    resourceApprovalSettings: z.record(z.string(), ApprovalSettings).nullish(),
    apiKey: z.unknown().optional(),
    mobileKey: z.unknown().optional(),
  })
  .transform(({ apiKey: _a, mobileKey: _m, ...rest }) => rest);

export const EnvironmentsSchema = z.looseObject({ items: z.array(EnvironmentSchema), totalCount: optNum });

export const ProjectSchema = z.looseObject({
  _id: z.string(),
  key: z.string(),
  name: z.string(),
  tags: z.array(z.string()).nullish(),
  includeInSnippetByDefault: optBool,
  _access: AccessSchema.nullish(),
  environments: EnvironmentsSchema.nullish(),
});

export const ProjectsSchema = z.looseObject({ items: z.array(ProjectSchema), totalCount: optNum });

export const ContextKindsSchema = z.looseObject({
  items: z.array(z.looseObject({ key: z.string(), name: optStr, archived: optBool, createdFrom: optStr })),
});

export const FlagSummarySchema = z.looseObject({
  key: z.string(),
  name: optStr,
  kind: optStr,
  tags: z.array(z.string()).nullish(),
  archived: optBool,
  temporary: optBool,
  customProperties: z.record(z.string(), z.looseObject({ name: optStr, value: z.array(z.string()).nullish() })).nullish(),
  environments: z.record(z.string(), z.looseObject({ on: optBool, _environmentName: optStr, lastModified: optNum, version: optNum })).nullish(),
  _version: optNum,
});
export const FlagsSchema = z.looseObject({ items: z.array(FlagSummarySchema), totalCount: optNum });
export type LdFlagSummary = z.infer<typeof FlagSummarySchema>;

const ClauseSchema = z.looseObject({ _id: optStr, contextKind: optStr, attribute: z.string(), op: z.string(), values: z.array(z.unknown()), negate: optBool });
const RolloutSchema = z.looseObject({
  variations: z.array(z.looseObject({ variation: z.number(), weight: z.number(), _untracked: optBool })),
  contextKind: optStr,
  bucketBy: optStr,
  seed: optNum,
});
const VariationOrRolloutSchema = z.looseObject({ variation: optNum, rollout: RolloutSchema.nullish() });
const TargetSchema = z.looseObject({ values: z.array(z.string()), variation: z.number(), contextKind: optStr });

export const FlagConfigSchema = z.looseObject({
  on: z.boolean(),
  archived: optBool,
  version: optNum,
  lastModified: optNum,
  offVariation: optNum,
  fallthrough: VariationOrRolloutSchema.nullish(),
  rules: z.array(z.looseObject({ _id: optStr, description: optStr, clauses: z.array(ClauseSchema), variation: optNum, rollout: RolloutSchema.nullish(), trackEvents: optBool })).nullish(),
  targets: z.array(TargetSchema).nullish(),
  contextTargets: z.array(TargetSchema).nullish(),
  prerequisites: z.array(z.looseObject({ key: z.string(), variation: z.number() })).nullish(),
});

/** Full flag (GET /flags/{p}/{key}). Used for pre-images, so every field must survive (looseObject). */
export const FlagSchema = z.looseObject({
  key: z.string(),
  name: z.string(),
  kind: optStr,
  description: optStr,
  _version: optNum,
  temporary: optBool,
  archived: optBool,
  tags: z.array(z.string()).nullish(),
  variations: z.array(z.looseObject({ _id: z.string(), value: z.unknown(), name: optStr, description: optStr })),
  customProperties: z.record(z.string(), z.looseObject({ name: optStr, value: z.array(z.string()).nullish() })).nullish(),
  clientSideAvailability: z.looseObject({ usingEnvironmentId: optBool, usingMobileKey: optBool }).nullish(),
  defaults: z.looseObject({ onVariation: z.number(), offVariation: z.number() }).nullish(),
  environments: z.record(z.string(), FlagConfigSchema).nullish(),
});
export type LdFlag = z.infer<typeof FlagSchema>;
export type LdFlagConfig = z.infer<typeof FlagConfigSchema>;

export const SegmentSchema = z.looseObject({
  key: z.string(),
  name: z.string(),
  description: optStr,
  tags: z.array(z.string()).nullish(),
  version: optNum,
  deleted: optBool,
  unbounded: optBool,
  included: z.array(z.string()).nullish(),
  excluded: z.array(z.string()).nullish(),
  includedContexts: z.array(z.looseObject({ contextKind: z.string(), values: z.array(z.string()) })).nullish(),
  excludedContexts: z.array(z.looseObject({ contextKind: z.string(), values: z.array(z.string()) })).nullish(),
  rules: z.array(z.looseObject({ _id: optStr, description: optStr, clauses: z.array(ClauseSchema), weight: optNum, rolloutContextKind: optStr, bucketBy: optStr })).nullish(),
});
export const SegmentsSchema = z.looseObject({ items: z.array(SegmentSchema), totalCount: optNum });
export type LdSegment = z.infer<typeof SegmentSchema>;

/** Any `{items: [...]}` collection, for probes where we only care that the route answers. */
export const CollectionSchema = z.looseObject({ items: z.array(z.unknown()).nullish(), totalCount: optNum });

export type LdCallerIdentity = z.infer<typeof CallerIdentitySchema>;
export type LdToken = z.infer<typeof TokenSchema>;
export type LdProject = z.infer<typeof ProjectSchema>;
export type LdEnvironment = z.infer<typeof EnvironmentSchema>;
export type LdAccess = z.infer<typeof AccessSchema>;
