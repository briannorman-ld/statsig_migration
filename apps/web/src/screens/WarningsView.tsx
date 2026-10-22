import type { CanonicalSnapshot } from '@sslm/canonical';
import type { SourceRecord } from '@sslm/store';
import { Badge, Callout, Card } from '../components/ui.tsx';

/** Schema mismatches, skipped endpoints, partial-spec hints: never silently swallowed. */
export function WarningsView({ sources, snapshots }: { sources: SourceRecord[]; snapshots: Record<string, CanonicalSnapshot | undefined> }) {
  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl font-semibold tracking-tight">Source warnings</h2>
      {sources.map((s) => {
        const w = snapshots[s.id]?.warnings ?? [];
        return (
          <Card key={s.id}>
            <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
              <span className="font-medium">{s.label}</span>
              <Badge tone={w.length ? 'amber' : 'green'}>{w.length} warnings</Badge>
              <span className="ml-auto text-xs text-fg-muted">missing from this source kind: {snapshots[s.id]?.completeness.missing.join(', ') || 'nothing'}</span>
            </div>
            {w.length === 0 ? (
              <div className="p-4"><Callout tone="green">No schema mismatches or skipped endpoints.</Callout></div>
            ) : (
              <ul className="divide-y divide-line-soft text-sm">
                {w.map((x, i) => (
                  <li key={i} className="flex gap-3 px-4 py-2">
                    <Badge tone={x.code === 'schema_mismatch' ? 'red' : 'amber'}>{x.code}</Badge>
                    <span className="font-mono text-xs text-fg-muted">{x.path}</span>
                    <span className="text-fg-muted">{x.message}</span>
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
