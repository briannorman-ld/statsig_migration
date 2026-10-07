import type { CanonicalSnapshot } from '@sslm/canonical';
import type { SourceRecord } from '@sslm/store';
import { Badge, Callout, Card } from '../components/ui.tsx';

/** Schema mismatches, skipped endpoints, partial-spec hints: never silently swallowed. */
export function WarningsView({ sources, snapshots }: { sources: SourceRecord[]; snapshots: Record<string, CanonicalSnapshot | undefined> }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Source warnings</h2>
      {sources.map((s) => {
        const w = snapshots[s.id]?.warnings ?? [];
        return (
          <Card key={s.id}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
              <span className="font-medium">{s.label}</span>
              <Badge tone={w.length ? 'amber' : 'green'}>{w.length} warnings</Badge>
              <span className="ml-auto text-xs text-slate-500">missing from this source kind: {snapshots[s.id]?.completeness.missing.join(', ') || 'nothing'}</span>
            </div>
            {w.length === 0 ? (
              <div className="p-4"><Callout tone="green">No schema mismatches or skipped endpoints.</Callout></div>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {w.map((x, i) => (
                  <li key={i} className="flex gap-3 px-4 py-2">
                    <Badge tone={x.code === 'schema_mismatch' ? 'red' : 'amber'}>{x.code}</Badge>
                    <span className="font-mono text-xs text-slate-500">{x.path}</span>
                    <span className="text-slate-700">{x.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
