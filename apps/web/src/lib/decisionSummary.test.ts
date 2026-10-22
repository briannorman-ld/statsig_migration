import { describe, expect, it } from 'vitest';
import type { DecisionPoint } from '@sslm/mapper';
import { filterDecisions, NO_FILTERS, summarizeDecisions } from './decisionSummary.ts';
import type { DecisionInstance } from './migration.ts';

const opt = (key: string, label = key) => ({ key, label, explanation: '', resultingFidelity: 'partial' as const });

function inst(over: Partial<DecisionPoint> & { id: string }, resolvedWith?: DecisionInstance['resolvedWith']): DecisionInstance {
  const decision: DecisionPoint = {
    type: 'gate_reference',
    severity: 'blocking',
    subject: { sourceId: 'src', kind: 'gate', uid: `src/gate/${over.id}`, id: over.id, location: 'rule "x" › condition 1' },
    title: 'Gate reference',
    explanation: '',
    sourceFragment: {},
    options: [opt('drop_condition', 'Drop the condition'), opt('skip', 'Skip this item')],
    fingerprint: 'fp',
    ...over,
  };
  return { decision, entityId: over.id, envs: ['production'], ...(resolvedWith ? { resolvedWith } : {}) };
}

describe('summarizeDecisions', () => {
  it('rolls decisions up by type with option coverage, item counts and the policy in force', () => {
    const all = [
      inst({ id: 'a' }),
      inst({ id: 'a', subject: { sourceId: 'src', kind: 'gate', uid: 'src/gate/a', id: 'a' }, options: [opt('prerequisite', 'Use as prerequisite'), opt('drop_condition', 'Drop the condition')] }),
      inst({ id: 'b', subject: { sourceId: 'src', kind: 'segment', uid: 'src/segment/b', id: 'b' } }),
      inst({ id: 'c' }, { optionKey: 'skip', via: 'policy' }),
      inst({ id: 'd', type: 'case_insensitive_match', severity: 'choice', recommended: 'exact', options: [opt('exact'), opt('matches_any')] }),
    ];
    const rows = summarizeDecisions(all, { case_insensitive_match: 'exact' });
    expect(rows.map((r) => r.type)).toEqual(['gate_reference', 'case_insensitive_match']); // blocking first
    const gr = rows[0]!;
    expect(gr).toMatchObject({ open: 3, decided: 1, openItems: 2, kinds: { gate: 2, segment: 1 }, recommendedOpen: 0 });
    expect(gr.policy).toBeUndefined();
    // drop_condition is offered by all three open decisions, skip by two, prerequisite by one
    expect(gr.options).toEqual([
      { key: 'drop_condition', label: 'Drop the condition', covers: 3 },
      { key: 'skip', label: 'Skip this item', covers: 2 },
      { key: 'prerequisite', label: 'Use as prerequisite', covers: 1 },
    ]);
    expect(rows[1]).toMatchObject({ open: 1, recommendedOpen: 1, policy: 'exact', policyLabel: 'exact' });
  });

  it('still knows the policy option’s label once every decision of that type is decided', () => {
    const all = [inst({ id: 'c', options: [opt('skip', 'Skip this item')] }, { optionKey: 'skip', via: 'policy' })];
    expect(summarizeDecisions(all, { gate_reference: 'skip' })[0]).toMatchObject({ open: 0, decided: 1, policy: 'skip', policyLabel: 'Skip this item', options: [] });
  });
});

describe('filterDecisions', () => {
  const all = [inst({ id: 'checkout_v2' }), inst({ id: 'beta', subject: { sourceId: 'other', kind: 'segment', uid: 'other/segment/beta', id: 'beta', ruleName: 'Beta testers' } }), inst({ id: 'x', severity: 'choice' })];
  it('passes everything through with no filters', () => {
    expect(filterDecisions(all, NO_FILTERS)).toHaveLength(3);
  });
  it('narrows by severity, kind, source and text', () => {
    expect(filterDecisions(all, { ...NO_FILTERS, severity: 'choice' }).map((x) => x.decision.subject.id)).toEqual(['x']);
    expect(filterDecisions(all, { ...NO_FILTERS, kind: 'segment' }).map((x) => x.decision.subject.id)).toEqual(['beta']);
    expect(filterDecisions(all, { ...NO_FILTERS, sourceId: 'other' }).map((x) => x.decision.subject.id)).toEqual(['beta']);
    expect(filterDecisions(all, { ...NO_FILTERS, query: 'CHECKOUT' }).map((x) => x.decision.subject.id)).toEqual(['checkout_v2']);
    expect(filterDecisions(all, { ...NO_FILTERS, query: 'beta testers' }).map((x) => x.decision.subject.id)).toEqual(['beta']);
  });
});
