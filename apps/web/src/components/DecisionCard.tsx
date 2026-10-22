import { useState } from 'react';
import type { DecisionPoint, Fidelity, Resolution, Severity } from '@sslm/mapper';
import { Badge, cx } from './ui.tsx';

export const SEVERITY_TONE: Record<Severity, 'red' | 'amber' | 'blue'> = { blocking: 'red', choice: 'amber', acknowledge: 'blue' };
export const FIDELITY_TONE: Record<Fidelity, 'green' | 'amber' | 'violet' | 'slate'> = { full: 'green', partial: 'amber', manual: 'violet', skipped: 'slate' };

export const TYPE_LABEL: Record<string, string> = {
  case_insensitive_match: 'Case-insensitive match',
  negated_missing_attribute: 'Missing attribute on a negative operator',
  partial_rollout_rebucket: 'Partial rollout re-bucketing',
  gate_reference: 'Gate reference',
  time_condition: 'Time condition',
  derived_attribute: 'Derived attribute',
  unit_type_kind: 'Unit type → context kind',
  key_collision: 'LD key already exists',
  source_collision: 'Same key in two sources',
  big_segment: 'Big ID list',
  hashed_id_list: 'Hashed ID list',
  id_list_unavailable: 'ID list not loaded',
  missing_reference: 'Missing reference',
  regex_dialect: 'Regex portability',
  null_check: 'Null check',
  client_side_availability: 'Client-side availability',
  unsupported_condition: 'No LD equivalent',
  rule_expansion: 'Rule expansion',
};

/**
 * One decision (or a group sharing a fingerprint): the explanation, the source fragment, and the
 * options as buttons (PLAN §8.2). `current` highlights the answer in force.
 */
export function DecisionCard({
  decision,
  count,
  current,
  stale,
  onChoose,
  onPolicy,
  compact,
}: {
  decision: DecisionPoint;
  count?: number;
  current?: { optionKey: string; via: 'resource' | 'policy' };
  stale?: Resolution;
  onChoose: (optionKey: string) => void;
  onPolicy?: (optionKey: string) => void;
  compact?: boolean;
}) {
  const [showFragment, setShowFragment] = useState(false);
  const d = decision;
  return (
    <div className={cx('rounded-md border bg-surface', d.severity === 'blocking' && !current ? 'border-error-line/60' : 'border-line', compact ? 'p-3' : 'p-4')}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[d.severity]}>{d.severity}</Badge>
        <span className="font-medium">{d.title}</span>
        {count && count > 1 && <Badge>{count} places</Badge>}
        {current && <Badge tone="green">{current.via === 'policy' ? 'workspace policy' : 'decided'}</Badge>}
      </div>
      <p className="mt-1.5 text-sm text-fg-muted">{d.explanation}</p>
      {stale && (
        <p className="mt-1.5 text-sm text-warning">
          Asked again because StatSig changed. Previous answer: <b>{d.options.find((o) => o.key === stale.optionKey)?.label ?? stale.optionKey}</b>.
        </p>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {d.options.map((o) => {
          const chosen = current?.optionKey === o.key;
          return (
            <div key={o.key} className={cx('flex flex-col rounded-md border p-2.5 text-sm', chosen ? 'border-accent ring-1 ring-accent' : 'border-line')}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">
                  {o.label}
                  {d.recommended === o.key && <span className="ml-1.5 text-xs font-normal text-success">recommended</span>}
                </span>
                <Badge tone={FIDELITY_TONE[o.resultingFidelity]}>{o.resultingFidelity}</Badge>
              </div>
              <p className="mt-1 flex-1 text-xs text-fg-muted">{o.explanation}</p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => onChoose(o.key)} disabled={chosen} className="rounded border border-line px-2 py-1 text-xs font-medium hover:bg-surface-hover disabled:opacity-50">
                  {chosen ? 'Chosen' : count && count > 1 ? `Apply to all ${count}` : 'Choose'}
                </button>
                {onPolicy && (
                  <button onClick={() => onPolicy(o.key)} className="rounded px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover" title="Use this answer for every decision of this type, now and in future snapshots">
                    Save as policy
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!compact && (
        <button className="mt-2 text-xs text-fg-muted hover:text-fg" onClick={() => setShowFragment((x) => !x)}>
          {showFragment ? 'Hide' : 'Show'} StatSig source
        </button>
      )}
      {showFragment && <pre className="mt-1 max-h-48 overflow-auto rounded border border-line bg-surface-2 p-2 font-mono text-xs">{JSON.stringify(d.sourceFragment, null, 2)}</pre>}
    </div>
  );
}
