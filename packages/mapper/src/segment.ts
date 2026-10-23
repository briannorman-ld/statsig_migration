/**
 * StatSig segment → LD segment in one environment (PLAN §6: rule-based and ID-list segments are
 * per environment in LD). Big (>15k) and hashed lists are left to M4; the gate that references
 * them already carries the blocking decision.
 */
import { fingerprint, resolveRulesForEnvironment, targetingFingerprint, type Segment } from '@sslm/canonical';
import { andDnf, LIST_SEGMENT_MAX, MAX_EXPANSION, resolveKind, segmentSize, SkipItem, translateCondition, unique, type ConditionContext } from './conditions.ts';
import { DecisionCollector } from './decisions.ts';
import { report, sourceTag, TAG_MIGRATED, type MapArgs, type MapOutcome } from './gate.ts';
import { sanitizeKey, sanitizeTag } from './profile.ts';
import { inlineGate, type InlineState } from './refs.ts';
import type { Dependency, DesiredSegment, DesiredSegmentRule, FidelityNote, LdClause } from './types.ts';

export interface SegmentMapResult extends MapOutcome {
  segmentKey: string;
  desired: DesiredSegment | null;
}

export function mapSegment(args: MapArgs<Segment>): SegmentMapResult {
  const { entity: seg, canonical, profile, capabilities, env } = args;
  const sourceId = seg.source.sourceId;
  const decisions = new DecisionCollector(args.resolutions, profile);
  const fidelity: FidelityNote[] = [];
  const deps = new Map<string, Dependency>();
  const idLists = canonical.idLists ?? {};
  const ctx: ConditionContext = {
    profile,
    capabilities,
    snapshot: canonical.snapshot,
    sourceId,
    idLists,
    nowMs: Date.parse(args.now),
    decisions,
    subject: { sourceId, kind: 'segment', uid: seg.uid, id: seg.id },
    fidelity,
    deps,
    userKind: 'user',
    kindCache: new Map(),
  };
  ctx.userKind = resolveKind(ctx, 'userID');
  const key = sanitizeKey(seg.id);
  const size = segmentSize(seg, idLists);
  const inline: InlineState = { env, stack: [], inlined: new Map(), cache: new Map() };

  const finish = (desired: DesiredSegment | null, skipped?: string): SegmentMapResult => ({
    uid: seg.uid,
    entityId: seg.id,
    sourceId,
    segmentKey: key,
    desired,
    fidelity: report(fidelity, skipped),
    unresolved: decisions.unresolved,
    applied: decisions.applied,
    stale: decisions.stale,
    dependencies: [...deps.values()],
    statsigFingerprint: fingerprint({ self: targetingFingerprint(seg, env.statsig), ids: size.ids ? [...size.ids].sort() : null, inlined: [...inline.inlined.entries()].sort() }),
    decisionSetHash: decisions.setHash(),
    ...(skipped ? { skipped } : {}),
  });

  if (seg.archived) return finish(null, 'archived in StatSig');
  const base: DesiredSegment = {
    key,
    ldEnv: env.ld,
    statsigEnv: env.statsig,
    name: seg.name || seg.id,
    description: seg.description ?? '',
    tags: unique([TAG_MIGRATED, sourceTag(canonical.snapshot.source.alias), ...seg.tags.map(sanitizeTag)].filter(Boolean)),
    rules: [],
    included: [],
    includedContexts: [],
  };

  try {
    if (seg.segmentType !== 'rule_based') {
      if (size.hashed) return finish(null, 'its ID list is hashed (config spec); raw-ID reconciliation arrives in M4');
      if ((size.count ?? 0) > LIST_SEGMENT_MAX) return finish(null, `${size.count} IDs exceed LD's ${LIST_SEGMENT_MAX.toLocaleString('en-US')}-ID list segment limit; big segments arrive in M4`);
      if (!size.ids) return finish(null, 'its ID list was not fetched from StatSig');
      const kind = resolveKind(ctx, seg.idType);
      const ids = unique(size.ids);
      if (kind === 'user') base.included = ids;
      else base.includedContexts = [{ contextKind: kind, values: ids }];
      fidelity.push({ fidelity: 'full', message: `${ids.length} ${seg.idType} IDs included.` });
      return finish(base);
    }

    ctx.gateReference = (ids, negate, _c, loc) => {
      const parts = ids.map((id) => inlineGate(ctx, inline, id, negate));
      const bad = parts.find((p) => !p.ok);
      // LD segments can't have prerequisites, so a gate reference must inline.
      if (bad && !bad.ok) throw new SkipItem(`rule “${loc.ruleName}” references a gate that can't be inlined (${bad.reason})`);
      return parts.flatMap((p) => (p.ok ? p.dnf : []));
    };
    if (!seg.enabled) fidelity.push({ fidelity: 'full', message: 'Disabled in StatSig: the LD segment has no rules, so nobody matches it.' });
    const rules = seg.enabled ? resolveRulesForEnvironment(seg.rules, env.statsig).rules : [];
    const out: DesiredSegmentRule[] = [];
    for (const r of rules) {
      if (r.passPercentage <= 0) continue;
      const dnf = andDnf(r.conditions.map((c, i) => translateCondition(ctx, c, { ruleId: r.id, ruleName: r.name, index: i })));
      if (!dnf) throw new SkipItem(`rule “${r.name}” expands into more than ${MAX_EXPANSION} LD rules`);
      const kind = resolveKind(ctx, r.idType || seg.idType);
      let weight: number | undefined;
      if (r.passPercentage < 100) {
        const choice = ctx.decisions.choose(
          {
            type: 'partial_rollout_rebucket',
            severity: 'acknowledge',
            subject: { ...ctx.subject, ruleId: r.id, ruleName: r.name, location: `rule “${r.name}”` },
            path: `rule:${r.id}:rollout`,
            title: `${r.passPercentage}% of matching users: re-bucketed`,
            explanation: `StatSig and LD hash users differently, so a different ${r.passPercentage}% of matching users are in the segment.`,
            sourceFragment: { rule: r.name, passPercentage: r.passPercentage },
            fingerprintOf: { passPercentage: r.passPercentage },
            options: [
              { key: 'acknowledge', label: 'Acknowledge: users will be re-bucketed', explanation: 'Migrate with the same percentage.', resultingFidelity: 'partial' },
              { key: 'skip', label: 'Skip this segment', explanation: "Don't migrate it.", resultingFidelity: 'skipped' },
            ],
            recommended: 'acknowledge',
          },
          'acknowledge',
        );
        if (choice === 'skip') throw new SkipItem(`waiting for the ${r.passPercentage}% rule “${r.name}”`);
        weight = Math.round(r.passPercentage * 1000);
        // KNOWN-EDGE-CASES 9.13: StatSig stops at the first matching rule (users outside the percentage
        // fail the segment); LD lets them continue to the next segment rule.
        const later = rules.slice(rules.indexOf(r) + 1).filter((x) => x.passPercentage > 0).length;
        if (later > 0)
          ctx.fidelity.push({
            fidelity: 'partial',
            message: `Users matching “${r.name}” but outside its ${r.passPercentage}% fail the segment in StatSig; in LD they go on to the ${later} later rule${later === 1 ? '' : 's'} and may match there.`,
            location: `rule “${r.name}”`,
          });
      }
      for (const [k, term] of dnf.entries()) {
        // LD segment rules need a clause; "everyone of this kind" is a match-anything key regex.
        const clauses: LdClause[] = term.length ? term : [{ contextKind: kind, attribute: 'key', op: 'matches', values: ['.*'], negate: false }];
        out.push({ description: dnf.length > 1 ? `${r.name} (${k + 1}/${dnf.length})` : r.name, clauses, ...(weight !== undefined ? { weight, rolloutContextKind: kind } : {}) });
      }
    }
    base.rules = out;
    return finish(base);
  } catch (e) {
    if (e instanceof SkipItem) return finish(null, e.reason);
    throw e;
  }
}
