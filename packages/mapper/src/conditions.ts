/**
 * StatSig condition → LD clauses (PLAN §10.3). Semantics follow the StatSig evaluator
 * (reference/repos/node-js-server-sdk/src/Evaluator.ts), not the docs:
 * - `any`/`none` and every `str_*_any` operator compare case-insensitively; LD's `in`,
 *   `contains`, `startsWith` and `endsWith` don't, so all of them raise `case_insensitive_match`.
 * - A missing attribute makes StatSig's negative operators (`none`, `str_contains_none`, `neq`)
 *   pass, while an LD clause on a missing attribute never matches, negated or not.
 *
 * A translated condition is a DNF (OR of ANDs): most conditions are one clause, but
 * `array_contains_all`, `on`, `not_array_contains_all` and inlined gate references expand.
 * `[]` never matches; `[[]]` always matches.
 */
import { normalizeCondition, toArray, type CanonicalSnapshot, type Condition, type Segment } from '@sslm/canonical';
import { DROP_CONDITION, DROP_RULE, SKIP, type DecisionCollector } from './decisions.ts';
import { attributeFor, kindFor, sanitizeKey } from './profile.ts';
import type { DecisionOption, DecisionSubject, Dependency, FidelityNote, IdLists, LdClause, LdOperator, MapperCapabilities, MappingProfile } from './types.ts';

export type Dnf = LdClause[][];
export const ALWAYS: Dnf = [[]];
export const NEVER: Dnf = [];

/** LD's limit for standard (non-big) list segments. */
export const LIST_SEGMENT_MAX = 15_000;
/** Upper bound on LD rules one StatSig rule may expand into. */
export const MAX_EXPANSION = 10;

export class SkipItem extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'SkipItem';
  }
}

export interface ConditionContext {
  profile: MappingProfile;
  capabilities: MapperCapabilities;
  snapshot: CanonicalSnapshot;
  sourceId: string;
  idLists: IdLists;
  nowMs: number;
  decisions: DecisionCollector;
  subject: DecisionSubject;
  fidelity: FidelityNote[];
  deps: Map<string, Dependency>;
  /** Kind that holds StatSig's user-level attributes (email, country, custom fields). */
  userKind: string;
  /** Resolves `passes_gate` / `fails_gate`; supplied by the gate mapper (PLAN §10.4). */
  gateReference?: (gateIds: string[], negate: boolean, c: Condition, loc: Loc) => Dnf;
  /** Set while translating an inlined gate's conditions, e.g. `via employees_only`. */
  pathPrefix?: string;
  /** Context-kind keys already decided for this mapping run, by unit type. */
  kindCache: Map<string, string>;
}

export interface Loc {
  ruleId: string;
  ruleName: string;
  index: number;
}

export function locLabel(ctx: ConditionContext, loc: Loc): string {
  return `${ctx.pathPrefix ? `${ctx.pathPrefix} › ` : ''}rule “${loc.ruleName}” › condition ${loc.index + 1}`;
}

function path(ctx: ConditionContext, loc: Loc): string {
  return `${ctx.pathPrefix ? `${ctx.pathPrefix} / ` : ''}rule:${loc.ruleId}:cond:${loc.index}`;
}

function note(ctx: ConditionContext, loc: Loc, fidelity: FidelityNote['fidelity'], message: string) {
  ctx.fidelity.push({ fidelity, message, location: locLabel(ctx, loc) });
}

function subjectAt(ctx: ConditionContext, loc: Loc): DecisionSubject {
  return { ...ctx.subject, ruleId: loc.ruleId, ruleName: loc.ruleName, location: locLabel(ctx, loc) };
}

/** Option keys that mean the same thing in every condition-level decision. */
function applyCommon(choice: string, loc: Loc): Dnf | undefined {
  if (choice === 'drop_condition') return ALWAYS;
  if (choice === 'drop_rule') return NEVER;
  if (choice === 'skip') throw new SkipItem(`skipped by decision at rule “${loc.ruleName}”`);
  return undefined;
}

/** Context kind for a unit type, raising `unit_type_kind` for kinds the LD project lacks. */
export function resolveKind(ctx: ConditionContext, unitType: string): string {
  const cached = ctx.kindCache.get(unitType.toLowerCase());
  if (cached) return cached;
  const proposed = kindFor(ctx.profile, ctx.sourceId, unitType);
  const configured = Object.keys(ctx.profile.sources[ctx.sourceId]?.unitTypeKinds ?? {}).some((k) => k.toLowerCase() === unitType.toLowerCase());
  let kind = proposed;
  if (proposed !== 'user' && !configured && !ctx.capabilities.existingContextKinds.includes(proposed)) {
    const existing = ctx.capabilities.existingContextKinds.filter((k) => k !== proposed);
    const canCreate = ctx.capabilities.contextKinds !== 'not_permitted' && ctx.capabilities.contextKinds !== 'unavailable';
    const options: DecisionOption[] = [
      {
        key: `create:${proposed}`,
        label: `Create context kind “${proposed}”`,
        explanation: canCreate
          ? `The migration creates the LD context kind “${proposed}” for StatSig's ${unitType}. Your app must send a “${proposed}” context.`
          : `This token can't create context kinds. Ask an LD admin to create “${proposed}” first; SDK evaluations also auto-create kinds.`,
        resultingFidelity: 'full',
      },
      ...existing.map((k) => ({ key: `existing:${k}`, label: `Use the existing kind “${k}”`, explanation: `StatSig's ${unitType} becomes the key of the LD “${k}” context.`, resultingFidelity: 'full' as const })),
    ];
    const choice = ctx.decisions.choose(
      {
        type: 'unit_type_kind',
        severity: 'choice',
        subject: { sourceId: ctx.sourceId, kind: 'unit_type', uid: `${ctx.sourceId}/unit_type/${unitType}`, id: unitType },
        path: 'kind',
        title: `Context kind for unit type ${unitType}`,
        explanation: `StatSig buckets and targets by ${unitType}. LD needs a context kind for it; custom unit IDs must not be collapsed into “user”.`,
        sourceFragment: { unitType },
        options,
        recommended: options[0]!.key,
      },
      options[0]!.key,
    );
    kind = choice.split(':').slice(1).join(':') || proposed;
  }
  ctx.kindCache.set(unitType.toLowerCase(), kind);
  if (kind !== 'user' && !ctx.capabilities.existingContextKinds.includes(kind)) ctx.deps.set(`context_kind:${kind}`, { kind: 'context_kind', key: kind, entityId: unitType });
  return kind;
}

export function translateCondition(ctx: ConditionContext, c: Condition, loc: Loc): Dnf {
  switch (c.type) {
    case 'public':
      return ALWAYS;
    case 'environment_tier':
      // resolveRulesForEnvironment removes every statically-decidable tier condition.
      return unsupported(ctx, c, loc, 'An environment-tier condition with an operator that cannot be resolved statically.');
    case 'passes_gate':
    case 'fails_gate': {
      const ids = toArray(c.targetValue).map(String);
      if (!ctx.gateReference) return unsupported(ctx, c, loc, 'Gate references are not supported here.');
      return ctx.gateReference(ids, c.type === 'fails_gate', c, loc);
    }
    case 'passes_segment':
    case 'fails_segment':
      return segmentCondition(ctx, c, loc, toArray(c.targetValue).map(String), c.type === 'fails_segment');
    case 'time':
      return timeCondition(ctx, c, loc);
    case 'user_id':
      return attributeCondition(ctx, c, loc, resolveKind(ctx, 'userID'), 'key');
    case 'unit_id':
      return attributeCondition(ctx, c, loc, resolveKind(ctx, c.customID ?? 'userID'), 'key');
    case 'email':
    case 'ip_address':
    case 'locale':
    case 'app_version':
    case 'custom_field':
      return mappedAttribute(ctx, c, loc);
    case 'country':
      return c.derivedFrom ? derived(ctx, c, loc) : mappedAttribute(ctx, c, loc);
    case 'browser_name':
    case 'browser_version':
    case 'os_name':
    case 'os_version':
    case 'device_model':
    case 'user_agent':
      return derived(ctx, c, loc);
    default:
      return unsupported(ctx, c, loc, UNSUPPORTED_WHY[c.type] ?? `StatSig condition type “${c.type}” has no LD equivalent.`);
  }
}

const UNSUPPORTED_WHY: Record<string, string> = {
  target_app: 'StatSig target apps decide which SDK keys see a gate. LD has no per-app targeting clause (the closest is the ld_application context, which needs SDK configuration).',
  javascript: 'Custom JavaScript conditions run inside StatSig only.',
  experiment_group: 'Experiment-group conditions depend on StatSig experiment assignment, which does not move to LD (PLAN §11).',
  url: 'StatSig reads the page URL in its web SDK. LD only sees attributes your app sends.',
  user_bucket: 'StatSig bucket conditions depend on StatSig hashing; LD buckets differently.',
  unknown: 'The source sent a condition type this app does not recognize.',
};

function mappedAttribute(ctx: ConditionContext, c: Condition, loc: Loc): Dnf {
  const { attribute, renamed } = attributeFor(ctx.profile, c.type, c.field);
  if (renamed) note(ctx, loc, 'full', `Custom field “${c.field}” maps to LD attribute “${attribute}” (“${c.field}” is reserved in LD).`);
  return attributeCondition(ctx, c, loc, ctx.userKind, attribute);
}

function derived(ctx: ConditionContext, c: Condition, loc: Loc): Dnf {
  const { attribute } = attributeFor(ctx.profile, c.type, c.field);
  const from = c.derivedFrom === 'ip' ? 'the IP address' : 'the user agent';
  const choice = ctx.decisions.choose(
    {
      type: 'derived_attribute',
      severity: 'choice',
      subject: subjectAt(ctx, loc),
      path: path(ctx, loc),
      title: `${c.type} is derived by StatSig`,
      explanation: `StatSig fills ${c.type} from ${from} when your app doesn't send it. LD SDKs don't derive attributes, so your app must send “${attribute}” (it is added to the context contract).`,
      sourceFragment: c.raw,
      fingerprintOf: { conditionType: c.type, attribute },
      options: [
        { key: 'map', label: `Map to attribute “${attribute}”`, explanation: `Target the LD attribute “${attribute}”. Exact once your app sends it.`, resultingFidelity: 'partial' },
        DROP_RULE,
        SKIP,
      ],
      recommended: 'map',
    },
    'map',
  );
  const common = applyCommon(choice, loc);
  if (common) return common;
  note(ctx, loc, 'partial', `Your app must send “${attribute}” (StatSig derived it from ${from}).`);
  return attributeCondition(ctx, c, loc, ctx.userKind, attribute);
}

// ---------------------------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------------------------

const CASE_INSENSITIVE: Record<string, { op: LdOperator; negate: boolean; anchor: 'full' | 'start' | 'end' | 'none' }> = {
  any: { op: 'in', negate: false, anchor: 'full' },
  none: { op: 'in', negate: true, anchor: 'full' },
  str_contains_any: { op: 'contains', negate: false, anchor: 'none' },
  str_contains_none: { op: 'contains', negate: true, anchor: 'none' },
  str_starts_with_any: { op: 'startsWith', negate: false, anchor: 'start' },
  str_ends_with_any: { op: 'endsWith', negate: false, anchor: 'end' },
};

/** StatSig operators that pass when the attribute is missing; LD clauses never do. */
const PASSES_WHEN_MISSING = new Set(['none', 'none_case_sensitive', 'str_contains_none', 'neq']);

function attributeCondition(ctx: ConditionContext, c: Condition, loc: Loc, contextKind: string, attribute: string): Dnf {
  const op = typeof c.operator === 'string' ? c.operator.toLowerCase() : null;
  const targets = toArray(c.targetValue);
  const clause = (o: LdOperator, values: unknown[], negate = false): LdClause => ({ contextKind, attribute, op: o, values, negate });
  const one = (o: LdOperator, values: unknown[], negate = false): Dnf => [[clause(o, values, negate)]];

  let out: Dnf;
  switch (op) {
    case 'any':
    case 'none':
    case 'str_contains_any':
    case 'str_contains_none':
    case 'str_starts_with_any':
    case 'str_ends_with_any':
      out = caseInsensitive(ctx, c, loc, op, targets, contextKind, attribute);
      break;
    case 'any_case_sensitive':
      out = one('in', targets.map(String));
      break;
    case 'none_case_sensitive':
      out = one('in', targets.map(String), true);
      break;
    case 'str_matches':
      out = regex(ctx, c, loc, targets.map(String), contextKind, attribute);
      break;
    case 'gt':
      out = one('greaterThan', targets.map(Number));
      break;
    case 'gte':
      out = one('greaterThanOrEqual', targets.map(Number));
      break;
    case 'lt':
      out = one('lessThan', targets.map(Number));
      break;
    case 'lte':
      out = one('lessThanOrEqual', targets.map(Number));
      break;
    case 'eq':
    case 'neq':
      if (c.targetValue === null || c.targetValue === undefined) return nullCheck(ctx, c, loc, op === 'eq' ? 'is_null' : 'is_not_null', contextKind, attribute);
      out = one('in', targets, op === 'neq');
      break;
    case 'version_gt':
      out = one('semVerGreaterThan', targets.map(String));
      break;
    case 'version_lt':
      out = one('semVerLessThan', targets.map(String));
      break;
    case 'version_eq':
      out = one('semVerEqual', targets.map(String));
      break;
    case 'version_neq':
      out = one('semVerEqual', targets.map(String), true);
      break;
    // PLAN §10.3 pitfall: >= is "not less than", <= is "not greater than".
    case 'version_gte':
      out = one('semVerLessThan', targets.map(String), true);
      break;
    case 'version_lte':
      out = one('semVerGreaterThan', targets.map(String), true);
      break;
    case 'before':
      out = one('before', targets.map(toTimestamp));
      break;
    case 'after':
      out = one('after', targets.map(toTimestamp));
      break;
    case 'on': {
      // Same calendar day (UTC): after the previous millisecond, before the next day.
      const days = targets.map(toTimestamp).filter((t): t is number => typeof t === 'number').map((t) => Math.floor(t / DAY) * DAY);
      if (days.length === 0) return unsupported(ctx, c, loc, 'The `on` date could not be parsed.');
      out = days.map((d) => [clause('after', [d - 1]), clause('before', [d + DAY])]);
      break;
    }
    case 'array_contains_any':
      out = one('in', targets);
      break;
    case 'array_contains_none':
      out = one('in', targets, true);
      break;
    case 'array_contains_all':
      out = [targets.map((t) => clause('in', [t]))];
      break;
    case 'not_array_contains_all':
      // De Morgan: "not (has a and has b)" = "lacks a" or "lacks b" → one LD rule per value.
      out = targets.map((t) => [clause('in', [t], true)]);
      if (out.length > 1) note(ctx, loc, 'full', `not_array_contains_all expands into ${out.length} LD rules (one per value).`);
      break;
    case 'is_null':
    case 'is_not_null':
      return nullCheck(ctx, c, loc, op, contextKind, attribute);
    case 'in_segment_list':
    case 'not_in_segment_list':
      return segmentCondition(ctx, c, loc, targets.map(String), op === 'not_in_segment_list');
    default:
      return unsupported(ctx, c, loc, `StatSig operator “${String(c.operator)}” has no LD equivalent.`);
  }

  if (op && PASSES_WHEN_MISSING.has(op) && !(contextKind === 'user' && attribute === 'key') && out.length > 0) {
    const choice = ctx.decisions.choose(
      {
        type: 'negated_missing_attribute',
        severity: 'acknowledge',
        subject: subjectAt(ctx, loc),
        path: path(ctx, loc),
        title: `Users without “${attribute}” behave differently`,
        explanation: `StatSig's “${op}” passes users who don't send ${attribute === 'key' ? `a ${contextKind} ID` : `“${attribute}”`}. In LD a clause on a missing attribute never matches, even when negated, so those users won't match this rule.`,
        sourceFragment: c.raw,
        fingerprintOf: { op, attribute, contextKind },
        options: [
          { key: 'acknowledge', label: 'Acknowledge', explanation: 'Migrate as is. Users missing the attribute no longer match this rule.', resultingFidelity: 'partial' },
          SKIP,
        ],
        recommended: 'acknowledge',
      },
      'acknowledge',
    );
    const common = applyCommon(choice, loc);
    if (common) return common;
    note(ctx, loc, 'partial', `Users without “${attribute}” no longer match (${op} on a missing attribute).`);
  }
  return out;
}

function caseInsensitive(ctx: ConditionContext, c: Condition, loc: Loc, op: string, targets: unknown[], contextKind: string, attribute: string): Dnf {
  const spec = CASE_INSENSITIVE[op]!;
  const values = targets.map(String);
  const clause = (o: LdOperator, vs: unknown[]): Dnf => [[{ contextKind, attribute, op: o, values: vs, negate: spec.negate }]];
  // Values with no cased letters (IPs, numbers) compare the same either way.
  if (values.every((v) => v.toLowerCase() === v.toUpperCase())) return clause(spec.op, values);

  const choice = ctx.decisions.choose(
    {
      type: 'case_insensitive_match',
      severity: 'choice',
      subject: subjectAt(ctx, loc),
      path: path(ctx, loc),
      title: `Case-insensitive match (${op})`,
      explanation: `StatSig's “${op}” ignores case: “${values[0]}” also matches “${values[0]!.toLowerCase()}”. LD's “${spec.op}” is case-sensitive.`,
      sourceFragment: c.raw,
      fingerprintOf: normalizeCondition(c),
      options: [
        { key: 'regex', label: 'Case-folded regex', explanation: `Use LD “matches” with a pattern that accepts any casing, e.g. ${caseFoldedPattern(values[0]!, spec.anchor)}. Exact, but harder to read and edit in LD.`, resultingFidelity: 'full' },
        { key: 'variants', label: 'Add lowercase and uppercase variants', explanation: `Keep “${spec.op}” and add each value as written, lowercased and uppercased. Mixed casings like “${mixedCase(values[0]!)}” won't match.`, resultingFidelity: 'partial' },
        { key: 'exact', label: 'Keep exact values (case-sensitive)', explanation: 'Only the exact casing in StatSig matches in LD.', resultingFidelity: 'partial' },
        SKIP,
      ],
      recommended: 'regex',
    },
    'regex',
  );
  const common = applyCommon(choice, loc);
  if (common) return common;
  if (choice === 'regex') return clause('matches', values.map((v) => caseFoldedPattern(v, spec.anchor)));
  if (choice === 'variants') {
    note(ctx, loc, 'partial', `Case-insensitive “${op}” approximated with lower/upper variants.`);
    return clause(spec.op, unique(values.flatMap((v) => [v, v.toLowerCase(), v.toUpperCase()])));
  }
  note(ctx, loc, 'partial', `Case-insensitive “${op}” migrated as case-sensitive.`);
  return clause(spec.op, values);
}

/** `[pP][rR][oO]`: a pattern every regex engine treats as case-insensitive for these letters. */
export function caseFoldedPattern(value: string, anchor: 'full' | 'start' | 'end' | 'none'): string {
  let body = '';
  for (const ch of value) {
    const lo = ch.toLowerCase();
    const up = ch.toUpperCase();
    body += lo !== up && [...lo].length === 1 && [...up].length === 1 ? `[${escapeClass(lo)}${escapeClass(up)}]` : escapeRegex(ch);
  }
  return `${anchor === 'full' || anchor === 'start' ? '^' : ''}${body}${anchor === 'full' || anchor === 'end' ? '$' : ''}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function escapeClass(s: string): string {
  return s.replace(/[\]\\^-]/g, '\\$&');
}

function mixedCase(v: string): string {
  return [...v].map((ch, i) => (i % 2 ? ch.toLowerCase() : ch.toUpperCase())).join('');
}

/** Constructs that behave differently (or fail) across SDK regex engines, e.g. RE2 in Go. */
const NON_PORTABLE_REGEX: { re: RegExp; what: string }[] = [
  { re: /\(\?<[=!]/, what: 'lookbehind' },
  { re: /\(\?[=!]/, what: 'lookahead' },
  { re: /\\[1-9]/, what: 'backreference' },
  { re: /\(\?P?<[A-Za-z]/, what: 'named group' },
  { re: /\\[pP]\{/, what: 'Unicode property escape' },
  { re: /[*+?}][+]/, what: 'possessive quantifier' },
  { re: /\(\?[imsx]+[:)]/, what: 'inline flags' },
];

function regex(ctx: ConditionContext, c: Condition, loc: Loc, patterns: string[], contextKind: string, attribute: string): Dnf {
  const found = unique(patterns.flatMap((p) => NON_PORTABLE_REGEX.filter((n) => n.re.test(p)).map((n) => n.what)));
  const out: Dnf = [[{ contextKind, attribute, op: 'matches', values: patterns, negate: false }]];
  if (found.length === 0) return out;
  const choice = ctx.decisions.choose(
    {
      type: 'regex_dialect',
      severity: 'choice',
      subject: subjectAt(ctx, loc),
      path: path(ctx, loc),
      title: `Regex uses ${found.join(', ')}`,
      explanation: `The pattern ${patterns.join(', ')} uses ${found.join(', ')}, which some LD SDK regex engines (for example Go's RE2) don't support. Those SDKs will treat the clause as not matching.`,
      sourceFragment: c.raw,
      fingerprintOf: { patterns },
      options: [
        { key: 'keep', label: 'Keep as is', explanation: 'Works in SDKs whose regex engine supports it (JavaScript, Java, .NET, Python).', resultingFidelity: 'partial' },
        DROP_RULE,
        SKIP,
      ],
      recommended: 'keep',
    },
    'keep',
  );
  const common = applyCommon(choice, loc);
  if (common) return common;
  note(ctx, loc, 'partial', `Regex uses ${found.join(', ')}; not portable to every SDK.`);
  return out;
}

function nullCheck(ctx: ConditionContext, c: Condition, loc: Loc, op: 'is_null' | 'is_not_null', contextKind: string, attribute: string): Dnf {
  const isNull = op === 'is_null';
  // A blocking `is_null` previews as "rule dropped"; only say so once the user has chosen it.
  const options: DecisionOption[] = isNull
    ? [DROP_RULE, SKIP]
    : [{ key: 'matches_any', label: 'Approximate with matches ".*"', explanation: `Matches users who send “${attribute}” as a string. Non-string values (numbers, booleans) won't match.`, resultingFidelity: 'partial' }, DROP_RULE, SKIP];
  const { choice, resolved } = ctx.decisions.chooseEx(
    {
      type: 'null_check',
      severity: isNull ? 'blocking' : 'choice',
      subject: subjectAt(ctx, loc),
      path: path(ctx, loc),
      title: isNull ? `“${attribute}” is not set` : `“${attribute}” is set`,
      explanation: isNull
        ? `LD has no clause that matches a missing attribute: a clause on a missing attribute never matches, even when negated. This rule can't be expressed in LD.`
        : `LD has no “is set” operator. A regex that matches anything is the closest equivalent for string attributes.`,
      sourceFragment: c.raw,
      fingerprintOf: { op, attribute },
      options,
      ...(isNull ? {} : { recommended: 'matches_any' }),
    },
    isNull ? 'drop_rule' : 'matches_any',
  );
  const common = applyCommon(choice, loc);
  if (common) {
    if (resolved) note(ctx, loc, 'partial', `Rule requiring “${attribute}” ${isNull ? 'not ' : ''}to be set dropped.`);
    return common;
  }
  note(ctx, loc, 'partial', `“is set” approximated with matches ".*" (strings only).`);
  return [[{ contextKind, attribute, op: 'matches', values: ['.*'], negate: false }]];
}

function unsupported(ctx: ConditionContext, c: Condition, loc: Loc, why: string): Dnf {
  const { choice, resolved } = ctx.decisions.chooseEx(
    {
      type: 'unsupported_condition',
      severity: 'blocking',
      subject: subjectAt(ctx, loc),
      path: path(ctx, loc),
      title: `No LD equivalent: ${c.type}${c.operator ? ` ${String(c.operator)}` : ''}`,
      explanation: why,
      sourceFragment: c.raw,
      fingerprintOf: normalizeCondition(c),
      options: [DROP_CONDITION, DROP_RULE, SKIP],
    },
    'drop_rule',
  );
  const common = applyCommon(choice, loc)!;
  if (resolved) note(ctx, loc, 'partial', choice === 'drop_condition' ? `Unsupported ${c.type} condition dropped (the rule matches more users).` : `Rule with an unsupported ${c.type} condition dropped.`);
  return common;
}

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

const DAY = 86_400_000;

/** StatSig accepts seconds or milliseconds since the epoch, or a date string. */
export function toTimestamp(v: unknown): number | string {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isNaN(n)) return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
  if (typeof v === 'string') {
    const d = Date.parse(v);
    if (!Number.isNaN(d)) return d;
  }
  return String(v);
}

/**
 * `time` conditions compare the current time. Resolved statically when the answer can't change
 * any more (an `after` in the past, a `before` in the past); otherwise a `time_condition` decision.
 */
function timeCondition(ctx: ConditionContext, c: Condition, loc: Loc): Dnf {
  const op = typeof c.operator === 'string' ? c.operator.toLowerCase() : '';
  const ts = toArray(c.targetValue).map(toTimestamp).filter((t): t is number => typeof t === 'number');
  if (ts.length !== 1) return unsupported(ctx, c, loc, 'The time condition has no single parseable timestamp.');
  const t = ts[0]!;
  const now = ctx.nowMs;
  let nowValue: boolean;
  let isStatic: boolean;
  switch (op) {
    case 'after':
    case 'gt':
    case 'gte':
      nowValue = op === 'gte' ? now >= t : now > t;
      isStatic = nowValue;
      break;
    case 'before':
    case 'lt':
    case 'lte':
      nowValue = op === 'lte' ? now <= t : now < t;
      isStatic = !nowValue;
      break;
    case 'on': {
      const today = Math.floor(now / DAY);
      const day = Math.floor(t / DAY);
      nowValue = today === day;
      isStatic = today > day;
      break;
    }
    default:
      return unsupported(ctx, c, loc, `Time operator “${op}” is not supported.`);
  }
  const when = new Date(t).toISOString().replace('.000Z', 'Z');
  if (isStatic) {
    note(ctx, loc, 'full', nowValue ? `Time condition (${op} ${when}) is always true now; dropped.` : `Time condition (${op} ${when}) can never be true again; rule dropped.`);
    return nowValue ? ALWAYS : NEVER;
  }
  const choice = ctx.decisions.choose(
    {
      type: 'time_condition',
      severity: 'choice',
      subject: subjectAt(ctx, loc),
      path: path(ctx, loc),
      title: `Time condition: ${op} ${when}`,
      explanation: `This rule ${nowValue ? 'applies now but stops' : 'starts applying'} at ${when}. LD clauses can't compare the current time; a scheduled change (Enterprise) can flip it at that moment, which arrives with M4.`,
      sourceFragment: c.raw,
      fingerprintOf: { op, t },
      options: [
        {
          key: 'resolve_now',
          label: nowValue ? 'Keep the rule without the time check' : 'Leave the rule out for now',
          explanation: `Mirror how StatSig behaves today, and re-sync after ${when} so LD catches up.`,
          resultingFidelity: 'partial',
        },
        SKIP,
      ],
      recommended: 'resolve_now',
    },
    'resolve_now',
  );
  const common = applyCommon(choice, loc);
  if (common) return common;
  note(ctx, loc, 'partial', `Time condition resolved as of the sync (${nowValue ? 'true' : 'false'}); re-sync after ${when}.`);
  return nowValue ? ALWAYS : NEVER;
}

// ---------------------------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------------------------

export function segmentSize(seg: Segment, idLists: IdLists): { count?: number; ids?: string[]; hashed: boolean } {
  const fetched = idLists[seg.uid];
  if (fetched) return { count: fetched.length, ids: fetched, hashed: false };
  if (seg.idList?.hashed) return { count: seg.idList.count, hashed: true };
  return { count: seg.idList?.ids?.length ?? seg.idList?.count, ids: seg.idList?.ids, hashed: false };
}

function segmentCondition(ctx: ConditionContext, c: Condition, loc: Loc, ids: string[], negate: boolean): Dnf {
  const clauses: LdClause[] = [];
  for (const id of ids) {
    const seg = ctx.snapshot.segments.find((s) => s.id === id);
    const blocked = (type: 'missing_reference' | 'big_segment' | 'hashed_id_list' | 'id_list_unavailable', title: string, explanation: string): Dnf => {
      const { choice, resolved } = ctx.decisions.chooseEx(
        { type, severity: 'blocking', subject: subjectAt(ctx, loc), path: `${path(ctx, loc)}:segment:${id}`, title, explanation, sourceFragment: c.raw, fingerprintOf: { segment: id, type }, options: [DROP_CONDITION, DROP_RULE, SKIP] },
        'drop_rule',
      );
      if (resolved) note(ctx, loc, 'partial', choice === 'drop_condition' ? `Condition on segment “${id}” dropped (the rule matches more users).` : `Rule requiring segment “${id}” dropped.`);
      return applyCommon(choice, loc)!;
    };
    if (!seg) return blocked('missing_reference', `Segment “${id}” not found`, `The rule references segment “${id}”, which isn't in this StatSig snapshot.`);
    if (seg.archived) return blocked('missing_reference', `Segment “${id}” is archived`, `The rule references an archived segment.`);
    if (seg.segmentType !== 'rule_based') {
      const size = segmentSize(seg, ctx.idLists);
      if (size.hashed)
        return blocked('hashed_id_list', `Segment “${id}” has only hashed IDs`, `The config spec ships this ID list as hashes. Upload the raw IDs to reconcile it (M4), or decide how to handle the rule now.`);
      if ((size.count ?? 0) > LIST_SEGMENT_MAX)
        return blocked('big_segment', `Segment “${id}” has ${size.count?.toLocaleString('en-US')} IDs`, `LD list segments hold at most ${LIST_SEGMENT_MAX.toLocaleString('en-US')} IDs. Bigger lists need a big segment with a CSV import (Enterprise), which arrives with M4.`);
      if (!size.ids)
        return blocked('id_list_unavailable', `Segment “${id}” members aren't loaded`, `The ID list (${size.count ?? '?'} IDs) wasn't fetched from StatSig. Refresh the source with a Console API key to load it.`);
    }
    const key = sanitizeKey(seg.id);
    ctx.deps.set(`segment:${key}`, { kind: 'segment', key, entityId: seg.id });
    clauses.push({ contextKind: 'user', attribute: 'segmentMatch', op: 'segmentMatch', values: [key], negate });
  }
  if (clauses.length <= 1) return [clauses];
  // Several segments in one condition (spec multi_pass/multi_fail): StatSig passes if *any* listed
  // segment passes (or fails). One clause with several values covers "in any"; "not in any one"
  // needs one LD rule per segment.
  if (negate) return clauses.map((cl) => [cl]);
  return [[{ ...clauses[0]!, values: clauses.flatMap((x) => x.values) }]];
}

// ---------------------------------------------------------------------------------------------
// DNF helpers
// ---------------------------------------------------------------------------------------------

/** AND of DNFs, distributing ORs. Returns `undefined` when the result exceeds `max` terms. */
export function andDnf(parts: Dnf[], max = MAX_EXPANSION): Dnf | undefined {
  let acc: Dnf = ALWAYS;
  for (const p of parts) {
    const next: Dnf = [];
    for (const a of acc) for (const b of p) next.push([...a, ...b]);
    if (next.length > max) return undefined;
    acc = next;
  }
  return acc;
}

/** NOT of a DNF, if it can be expressed: each conjunct becomes an OR of negated clauses. */
export function notDnf(d: Dnf, max = MAX_EXPANSION): Dnf | undefined {
  if (d.length === 0) return ALWAYS;
  const negatedTerms: Dnf[] = d.map((term) => (term.length === 0 ? NEVER : term.map((cl) => [{ ...cl, negate: !cl.negate }])));
  return andDnf(negatedTerms, max);
}

export function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
