import type { CanonicalSnapshot, SnapshotWarning } from '@sslm/canonical';
import type { SourceRecord } from '@sslm/store';
import { PagerBar, usePager } from '../components/Pager.tsx';
import { Badge, Callout, Card } from '../components/ui.tsx';

/** Schema mismatches, skipped endpoints, partial-spec hints: never silently swallowed. */
export function WarningsView({ sources, snapshots }: { sources: SourceRecord[]; snapshots: Record<string, CanonicalSnapshot | undefined> }) {
  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl font-semibold tracking-tight">Source warnings</h2>
      {sources.map((s) => (
        <SourceWarnings key={s.id} source={s} snapshot={snapshots[s.id]} />
      ))}
    </div>
  );
}

function SourceWarnings({ source, snapshot }: { source: SourceRecord; snapshot: CanonicalSnapshot | undefined }) {
  const w: SnapshotWarning[] = snapshot?.warnings ?? [];
  const pager = usePager(w);
  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
        <span className="font-medium">{source.label}</span>
        <Badge tone={w.length ? 'amber' : 'green'}>{w.length} warnings</Badge>
        <span className="ml-auto text-xs text-fg-muted">missing from this source kind: {snapshot?.completeness.missing.join(', ') || 'nothing'}</span>
      </div>
      {w.length === 0 ? (
        <div className="p-4">
          <Callout tone="green">No schema mismatches or skipped endpoints.</Callout>
        </div>
      ) : (
        <>
          <PagerBar pager={pager} label="warnings" className="px-4 py-2" />
          <ul className="divide-y divide-line-soft text-sm">
            {pager.slice.map((x, i) => (
              <li key={`${pager.from}-${i}`} className="flex gap-3 px-4 py-2">
                <Badge tone={x.code === 'schema_mismatch' ? 'red' : 'amber'}>{x.code}</Badge>
                <span className="font-mono text-xs text-fg-muted">{x.path}</span>
                <span className="text-fg-muted">{x.message}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
