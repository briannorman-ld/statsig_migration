import { useMemo, useState } from 'react';
import type { CanonicalSnapshot } from '@sslm/canonical';
import type { DecisionType } from '@sslm/mapper';
import { recommendedResolutions } from '@sslm/planner';
import { DecisionCard, SEVERITY_TONE, TYPE_LABEL } from '../components/DecisionCard.tsx';
import { Badge, Button, Callout, Card, cx } from '../components/ui.tsx';
import { collectDecisions, decisionLogCsv, decisionLogMarkdown, download, type DecisionInstance } from '../lib/migration.ts';
import type { MigrationContext } from '../lib/useMigration.ts';

/**
 * Decisions inbox (PLAN §8.2). Decisions are grouped by type, then by fingerprint (the same
 * question asked in many places), so one answer can resolve e.g. "case-insensitive match — 31
 * conditions in 17 gates".
 */
export function DecisionsView({ snapshots, m, workspaceName }: { snapshots: CanonicalSnapshot[]; m: MigrationContext; workspaceName: string }) {
  const [tab, setTab] = useState<'open' | 'decided'>('open');
  const [expanded, setExpanded] = useState<string>();
  const all = useMemo(() => collectDecisions(snapshots, m.profile, m.connected, m), [snapshots, m]);
  const open = all.filter((d) => !d.resolvedWith);
  const decided = all.filter((d) => d.resolvedWith);
  const list = tab === 'open' ? open : decided;
  const choiceCount = open.filter((d) => d.decision.severity === 'choice' && d.decision.recommended).length;

  const groups = useMemo(() => {
    const byType = new Map<DecisionType, Map<string, DecisionInstance[]>>();
    for (const d of list) {
      const t = byType.get(d.decision.type) ?? new Map<string, DecisionInstance[]>();
      const key = tab === 'decided' ? `${d.decision.fingerprint}|${d.resolvedWith?.optionKey}` : d.decision.fingerprint;
      t.set(key, [...(t.get(key) ?? []), d]);
      byType.set(d.decision.type, t);
    }
    const rank = { blocking: 0, choice: 1, acknowledge: 2 } as const;
    return [...byType.entries()].sort(([, a], [, b]) => rank[[...a.values()][0]![0]!.decision.severity] - rank[[...b.values()][0]![0]!.decision.severity]);
  }, [list, tab]);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Decisions</h2>
        <div className="flex rounded-md border border-slate-300 text-sm">
          {(['open', 'decided'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cx('px-3 py-1.5 first:rounded-l-md last:rounded-r-md', tab === t ? 'bg-slate-900 text-white' : 'hover:bg-slate-50')}>
              {t === 'open' ? `Open (${open.length})` : `Decided (${decided.length})`}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          {tab === 'open' && (
            <Button variant="secondary" disabled={!choiceCount} onClick={() => void m.saveResolutions(recommendedResolutions(open.map((d) => d.decision), new Date().toISOString()))}>
              Use recommended for {choiceCount} choice{choiceCount === 1 ? '' : 's'}
            </Button>
          )}
          <Button variant="secondary" onClick={() => download('decision-log.md', decisionLogMarkdown(workspaceName, all, m.resolutions, m.profile), 'text/markdown')}>
            Export log (.md)
          </Button>
          <Button variant="ghost" onClick={() => download('decision-log.csv', decisionLogCsv(all), 'text/csv')}>
            .csv
          </Button>
        </div>
      </div>
      <p className="text-sm text-slate-500">
        Every place where StatSig can't be translated exactly becomes a decision. Answers apply in every environment and are saved in this workspace.
        {!m.connected && ' Connect LaunchDarkly and map environments to see only the environments you will migrate.'}
        {' '}Blocking and acknowledge decisions always need your answer.
      </p>
      {Object.keys(m.profile.policies).length > 0 && (
        <Card className="p-3 text-sm">
          <div className="mb-1 text-xs font-semibold text-slate-500">Workspace policies</div>
          <ul className="space-y-1">
            {Object.entries(m.profile.policies).map(([t, o]) => (
              <li key={t} className="flex items-center gap-2">
                <span>{TYPE_LABEL[t] ?? t}</span> → <b>{o}</b>
                <button className="ml-2 text-xs text-slate-500 hover:text-red-700" onClick={() => void m.setPolicy(t as DecisionType, null)}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {list.length === 0 && <Callout tone="green">{tab === 'open' ? 'No open decisions.' : 'Nothing decided yet.'}</Callout>}
      {groups.map(([type, byFp]) => {
        const instances = [...byFp.values()].flat();
        const entities = new Set(instances.map((i) => i.decision.subject.uid)).size;
        const sev = instances[0]!.decision.severity;
        return (
          <section key={type} className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              {TYPE_LABEL[type] ?? type}
              <Badge tone={SEVERITY_TONE[sev]}>{sev}</Badge>
              <span className="font-normal text-slate-500">
                {instances.length} decision{instances.length === 1 ? '' : 's'} in {entities} item{entities === 1 ? '' : 's'}
              </span>
            </h3>
            {[...byFp.entries()].map(([fp, xs]) => {
              const sample = xs[0]!;
              const groupKey = `${type}|${fp}`;
              return (
                <div key={groupKey} className="space-y-1">
                  <DecisionCard
                    decision={sample.decision}
                    count={xs.length}
                    {...(sample.resolvedWith ? { current: sample.resolvedWith } : {})}
                    {...(sample.stale ? { stale: sample.stale } : {})}
                    onChoose={(o) => void m.resolve(xs.map((x) => x.decision), o)}
                    onPolicy={(o) => void m.setPolicy(type, o)}
                  />
                  <button className="text-xs text-slate-500 hover:text-slate-800" onClick={() => setExpanded(expanded === groupKey ? undefined : groupKey)}>
                    {expanded === groupKey ? 'Hide' : 'Show'} the {xs.length} affected place{xs.length === 1 ? '' : 's'}
                  </button>
                  {expanded === groupKey && (
                    <ul className="ml-3 space-y-1 border-l border-slate-200 pl-3 text-xs">
                      {xs.map((x) => (
                        <li key={x.decision.id} className="flex flex-wrap items-center gap-2">
                          <code className="font-medium">{x.decision.subject.id}</code>
                          <span className="text-slate-500">{x.decision.subject.location}</span>
                          <span className="text-slate-400">({x.envs.join(', ')})</span>
                          {x.decision.options.map((o) => (
                            <button key={o.key} onClick={() => void m.resolve([x.decision], o.key)} className={cx('rounded border px-1.5 py-0.5', x.resolvedWith?.optionKey === o.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:bg-slate-100')}>
                              {o.label}
                            </button>
                          ))}
                          {x.resolvedWith?.via === 'resource' && (
                            <button className="text-slate-400 hover:text-red-700" onClick={() => void m.clear([x.decision.id])}>
                              reset
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
