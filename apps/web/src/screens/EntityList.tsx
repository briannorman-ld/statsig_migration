import { entitiesOf, type CanonicalSnapshot, type EntityKind } from '@sslm/canonical';
import type { SourceRecord } from '@sslm/store';
import { Badge, Callout, Card } from '../components/ui.tsx';

/** Bare name list for non-gate resources. The full side-by-side explorer is M2. */
export function EntityList({ kind, label, sources, snapshots }: { kind: EntityKind; label: string; sources: SourceRecord[]; snapshots: Record<string, CanonicalSnapshot | undefined> }) {
  const rows = sources.flatMap((s) => entitiesOf(snapshots[s.id]!, kind).map((e) => ({ s, e })));
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-display text-xl font-semibold tracking-tight">{label}</h2>
        <Badge>{rows.length}</Badge>
      </div>
      <div className="mb-3">
        <Callout tone="blue">Read-only inventory. The side-by-side explorer for this resource type arrives in M2.</Callout>
      </div>
      <Card>
        <ul className="divide-y divide-line-soft text-sm">
          {rows.map(({ s, e }) => (
            <li key={e.uid} className="flex items-center gap-2 px-3 py-2">
              <span className="font-mono text-[13px]">{e.id}</span>
              {sources.length > 1 && <Badge>{s.alias}</Badge>}
              {e.archived && <Badge>archived</Badge>}
              {'status' in e && typeof e.status === 'string' && <Badge tone="blue">{e.status}</Badge>}
              {e.completeness.missing.includes('idListMembers') && <Badge tone="amber" title="IDs not fetched yet / hashed">IDs pending</Badge>}
              <span className="ml-2 truncate text-xs text-fg-muted">{e.description}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
