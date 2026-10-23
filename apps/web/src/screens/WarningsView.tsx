import { useMemo, useState } from 'react';
import { entityUid, type CanonicalSnapshot, type SnapshotWarning } from '@sslm/canonical';
import type { SourceRecord } from '@sslm/store';
import { PagerBar, usePager } from '../components/Pager.tsx';
import { Badge, Button, Callout, Card, Spinner } from '../components/ui.tsx';
import { fetchDeferredIdListsReport, ID_LIST_FETCH_MAX, type IdListFetchReport } from '../lib/migration.ts';
import type { MigrationContext } from '../lib/useMigration.ts';

const ID_LIST_PATH = /^\/segments\/(.+)\/id_list$/;

/** Segment id of a deferred-list warning path, or '' for any other warning. */
function segmentOf(path: string): string {
  return ID_LIST_PATH.exec(path)?.[1] ?? '';
}

/**
 * Schema mismatches, skipped endpoints, partial-spec hints: never silently swallowed. Deferred
 * ID lists (the common `fetch_skipped`) can be loaded from here, and a source re-synced, because
 * the automatic load after a sync has nothing to show when it fails (no key in memory after a
 * refresh, a dropped request).
 */
export function WarningsView({
  workspaceId,
  sources,
  snapshots,
  m,
  onResync,
}: {
  workspaceId: string;
  sources: SourceRecord[];
  snapshots: Record<string, CanonicalSnapshot | undefined>;
  m: MigrationContext | null;
  onResync: (source: SourceRecord) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl font-semibold tracking-tight">Source warnings</h2>
      {sources.map((s) => (
        <SourceWarnings key={s.id} workspaceId={workspaceId} source={s} snapshot={snapshots[s.id]} m={m} onResync={() => onResync(s)} />
      ))}
    </div>
  );
}

type Fetch = { kind: 'idle' } | { kind: 'running'; message: string } | { kind: 'done'; report: IdListFetchReport } | { kind: 'error'; message: string };

function SourceWarnings({ workspaceId, source, snapshot, m, onResync }: { workspaceId: string; source: SourceRecord; snapshot: CanonicalSnapshot | undefined; m: MigrationContext | null; onResync: () => void }) {
  const w: SnapshotWarning[] = snapshot?.warnings ?? [];
  const pager = usePager(w);
  const [fetch, setFetch] = useState<Fetch>({ kind: 'idle' });

  // Deferred ID lists by segment id: loaded already (in IndexedDB), loadable now, or too big (M4).
  const idLists = useMemo(() => {
    const out = new Map<string, 'loaded' | 'loadable' | 'too_big'>();
    if (!snapshot) return out;
    for (const x of w) {
      const seg = segmentOf(x.path ?? "");
      if (!seg || x.code !== 'fetch_skipped') continue;
      const entity = snapshot.segments.find((s) => s.id === seg);
      const loaded = !!m?.idLists[entityUid(snapshot.source.sourceId, 'segment', seg)] || !!entity?.idList?.ids;
      out.set(seg, loaded ? 'loaded' : (entity?.idList?.count ?? 0) > ID_LIST_FETCH_MAX ? 'too_big' : 'loadable');
    }
    return out;
  }, [w, snapshot, m?.idLists]);
  const loadable = [...idLists.values()].filter((v) => v === 'loadable').length;
  const tooBig = [...idLists.values()].filter((v) => v === 'too_big').length;

  const load = async () => {
    if (!m || !snapshot) return;
    setFetch({ kind: 'running', message: 'Starting…' });
    try {
      const report = await fetchDeferredIdListsReport(workspaceId, [source], [snapshot], m.idLists, (message) => setFetch({ kind: 'running', message }));
      setFetch({ kind: 'done', report });
    } catch (e) {
      setFetch({ kind: 'error', message: (e as Error).message });
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5">
        <span className="font-medium">{source.label}</span>
        <Badge tone={w.length ? 'amber' : 'green'}>{w.length} warnings</Badge>
        <span className="text-xs text-fg-muted">missing from this source kind: {snapshot?.completeness.missing.join(', ') || 'nothing'}</span>
        <div className="ml-auto flex items-center gap-2">
          {idLists.size > 0 && source.kind === 'console_api' && (
            <Button variant="secondary" className="py-1 text-xs" disabled={fetch.kind === 'running' || !m || loadable === 0} onClick={() => void load()} title={loadable === 0 ? 'Every loadable list is loaded; the rest are above the on-demand limit' : `Load the ${loadable} deferred list${loadable === 1 ? '' : 's'} of ≤${ID_LIST_FETCH_MAX.toLocaleString()} IDs`}>
              {fetch.kind === 'running' ? <Spinner /> : null} Load deferred ID lists{loadable ? ` (${loadable})` : ''}
            </Button>
          )}
          {source.kind === 'console_api' && (
            <Button variant="secondary" className="py-1 text-xs" onClick={onResync} title="Crawl StatSig again and retry every skipped endpoint">
              Sync again
            </Button>
          )}
        </div>
      </div>
      {fetch.kind === 'running' && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-fg-muted">
          <Spinner /> {fetch.message}
        </div>
      )}
      {fetch.kind === 'error' && (
        <div className="px-4 py-2">
          <Callout tone="red">{fetch.message}</Callout>
        </div>
      )}
      {fetch.kind === 'done' && (
        <div className="px-4 py-2">
          <Callout tone={fetch.report.blocked.length ? 'amber' : 'green'}>
            Loaded {fetch.report.loaded.length} ID list{fetch.report.loaded.length === 1 ? '' : 's'}.
            {fetch.report.tooBig.length > 0 && ` ${fetch.report.tooBig.length} stay deferred: above ${ID_LIST_FETCH_MAX.toLocaleString()} IDs, they migrate as big segments (M4).`}
            {fetch.report.blocked.map((b) => ` ${b.reason}`)}
          </Callout>
        </div>
      )}
      {w.length === 0 ? (
        <div className="p-4">
          <Callout tone="green">No schema mismatches or skipped endpoints.</Callout>
        </div>
      ) : (
        <>
          {tooBig > 0 && fetch.kind === 'idle' && (
            <div className="px-4 pt-2 text-xs text-fg-muted">
              {tooBig} deferred list{tooBig === 1 ? ' is' : 's are'} above {ID_LIST_FETCH_MAX.toLocaleString()} IDs and can't be loaded on demand: those segments migrate as big segments (M4).
            </div>
          )}
          <PagerBar pager={pager} label="warnings" className="px-4 py-2" />
          <ul className="divide-y divide-line-soft text-sm">
            {pager.slice.map((x, i) => {
              const seg = segmentOf(x.path ?? "");
              const state = seg ? idLists.get(seg) : undefined;
              return (
                <li key={`${pager.from}-${i}`} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <Badge tone={x.code === 'schema_mismatch' ? 'red' : 'amber'}>{x.code}</Badge>
                  <span className="font-mono text-xs text-fg-muted">{x.path}</span>
                  <span className="text-fg-muted">{x.message}</span>
                  {state === 'loaded' && <Badge tone="green">loaded</Badge>}
                  {state === 'too_big' && <Badge tone="violet" title="Big segment: CSV import arrives in M4">big segment</Badge>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
