import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { parseIdListFile } from '@sslm/adapters';
import { entityUid, type CanonicalSnapshot, type Segment, type SnapshotWarning } from '@sslm/canonical';
import { LIST_SEGMENT_MAX } from '@sslm/mapper';
import type { IdListHashesRecord, IdListRecord, SourceRecord } from '@sslm/store';
import { PagerBar, usePager } from '../components/Pager.tsx';
import { Badge, Button, Callout, Card, Spinner } from '../components/ui.tsx';
import { fetchDeferredIdListsReport, ID_LIST_AUTO_MAX, ID_LIST_FETCH_MAX, type IdListFetchReport } from '../lib/migration.ts';
import { store } from '../lib/store.ts';
import type { MigrationContext } from '../lib/useMigration.ts';
import { pipeline } from '../pipeline/client.ts';

const ID_LIST_PATH = /^\/segments\/(.+)\/id_list$/;

/** Segment id of a deferred-list warning path, or '' for any other warning. */
function segmentOf(path: string): string {
  return ID_LIST_PATH.exec(path)?.[1] ?? '';
}

const n = (x: number | undefined) => (x ?? 0).toLocaleString('en-US');

/**
 * Schema mismatches, skipped endpoints, partial-spec hints: never silently swallowed. The ID-list
 * panel handles the lists a source can't deliver on its own: deferred Console API lists (loaded on
 * request, including the big ones), and a config spec's hashed lists, which need the `get_id_lists`
 * files and a raw-ID CSV to reconcile (PLAN §4.2).
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
  const idListRecs = useLiveQuery(() => store.listIdLists(workspaceId), [workspaceId]) ?? [];
  const hashRecs = useLiveQuery(() => store.listIdListHashes(workspaceId), [workspaceId]) ?? [];
  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl font-semibold tracking-tight">Source warnings</h2>
      {sources.map((s) => (
        <SourceWarnings key={s.id} workspaceId={workspaceId} source={s} snapshot={snapshots[s.id]} m={m} idListRecs={idListRecs} hashRecs={hashRecs} onResync={() => onResync(s)} />
      ))}
    </div>
  );
}

type Fetch = { kind: 'idle' } | { kind: 'running'; message: string } | { kind: 'done'; report: IdListFetchReport } | { kind: 'error'; message: string };

function SourceWarnings({
  workspaceId,
  source,
  snapshot,
  m,
  idListRecs,
  hashRecs,
  onResync,
}: {
  workspaceId: string;
  source: SourceRecord;
  snapshot: CanonicalSnapshot | undefined;
  m: MigrationContext | null;
  idListRecs: IdListRecord[];
  hashRecs: IdListHashesRecord[];
  onResync: () => void;
}) {
  const w: SnapshotWarning[] = snapshot?.warnings ?? [];
  const pager = usePager(w);
  const [fetch, setFetch] = useState<Fetch>({ kind: 'idle' });

  // Deferred ID lists by segment id: loaded already (in IndexedDB) or loadable on request.
  const idLists = useMemo(() => {
    const out = new Map<string, 'loaded' | 'loadable' | 'too_big'>();
    if (!snapshot) return out;
    for (const x of w) {
      const seg = segmentOf(x.path ?? '');
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
      const report = await fetchDeferredIdListsReport(workspaceId, [source], [snapshot], m.idLists, (message) => setFetch({ kind: 'running', message }), ID_LIST_FETCH_MAX);
      setFetch({ kind: 'done', report });
    } catch (e) {
      setFetch({ kind: 'error', message: (e as Error).message });
    }
  };

  // Lists the mapper can't use as delivered: hashed (spec), deferred (console), or uploaded.
  const lists = useMemo(() => (snapshot?.segments ?? []).filter((s) => s.segmentType !== 'rule_based' && !s.archived && (s.idList?.hashed || !s.idList?.ids || idListRecs.some((r) => r.uid === s.uid))), [snapshot, idListRecs]);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5">
        <span className="font-medium">{source.label}</span>
        <Badge tone={w.length ? 'amber' : 'green'}>{w.length} warnings</Badge>
        <span className="text-xs text-fg-muted">missing from this source kind: {snapshot?.completeness.missing.join(', ') || 'nothing'}</span>
        <div className="ml-auto flex items-center gap-2">
          {idLists.size > 0 && source.kind === 'console_api' && (
            <Button
              variant="secondary"
              className="py-1 text-xs"
              disabled={fetch.kind === 'running' || !m || loadable === 0}
              onClick={() => void load()}
              title={loadable === 0 ? 'Every loadable list is loaded' : `Load the ${loadable} deferred list${loadable === 1 ? '' : 's'} (lists above ${ID_LIST_AUTO_MAX.toLocaleString()} IDs are not loaded automatically; they migrate as big segments)`}
            >
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
            {fetch.report.tooBig.length > 0 && ` ${fetch.report.tooBig.length} stay deferred: above ${ID_LIST_FETCH_MAX.toLocaleString()} IDs, which is more than the Console API budget allows in one go.`}
            {fetch.report.blocked.map((b) => ` ${b.reason}`)}
          </Callout>
        </div>
      )}
      {snapshot && lists.length > 0 && m && <IdListsPanel workspaceId={workspaceId} source={source} snapshot={snapshot} segments={lists} m={m} idListRecs={idListRecs} hashRecs={hashRecs} />}
      {w.length === 0 ? (
        <div className="p-4">
          <Callout tone="green">No schema mismatches or skipped endpoints.</Callout>
        </div>
      ) : (
        <>
          {tooBig > 0 && fetch.kind === 'idle' && (
            <div className="px-4 pt-2 text-xs text-fg-muted">
              {tooBig} deferred list{tooBig === 1 ? ' is' : 's are'} above {ID_LIST_FETCH_MAX.toLocaleString()} IDs and can't be loaded through the Console API budget; export the list from StatSig and upload it as a raw-ID CSV below.
            </div>
          )}
          <PagerBar pager={pager} label="warnings" className="px-4 py-2" />
          <ul className="divide-y divide-line-soft text-sm">
            {pager.slice.map((x, i) => {
              const seg = segmentOf(x.path ?? '');
              const state = seg ? idLists.get(seg) : undefined;
              return (
                <li key={`${pager.from}-${i}`} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <Badge tone={x.code === 'schema_mismatch' ? 'red' : 'amber'}>{x.code}</Badge>
                  <span className="font-mono text-xs text-fg-muted">{x.path}</span>
                  <span className="text-fg-muted">{x.message}</span>
                  {state === 'loaded' && <Badge tone="green">loaded</Badge>}
                  {state === 'loadable' && <Badge tone="violet" title="Above the automatic limit: load it on request; it migrates as a big segment">big segment</Badge>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

type Busy = { uid: string; message: string } | null;

/**
 * One row per ID list the source can't deliver ready to use. Uploads stay in IndexedDB (customer
 * data, local only); hashing runs in the pipeline worker. The mapper reads the result through
 * `idLists` and `coverage`, so the Decisions page updates as soon as a list is reconciled.
 */
function IdListsPanel({
  workspaceId,
  source,
  snapshot,
  segments,
  m,
  idListRecs,
  hashRecs,
}: {
  workspaceId: string;
  source: SourceRecord;
  snapshot: CanonicalSnapshot;
  segments: Segment[];
  m: MigrationContext;
  idListRecs: IdListRecord[];
  hashRecs: IdListHashesRecord[];
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string>();
  const hashInput = useRef<Record<string, HTMLInputElement | null>>({});
  const rawInput = useRef<Record<string, HTMLInputElement | null>>({});

  const uploadHashes = async (seg: Segment, files: FileList | null) => {
    if (!files?.length) return;
    setError(undefined);
    setBusy({ uid: seg.uid, message: `Reading ${files.length} hash file${files.length === 1 ? '' : 's'}…` });
    try {
      const existing = hashRecs.find((r) => r.uid === seg.uid);
      const set = new Set(existing?.hashes ?? []);
      const names = [...(existing?.fileNames ?? [])];
      for (const f of Array.from(files).sort((a, b) => a.lastModified - b.lastModified)) {
        parseIdListFile(await f.text(), set);
        names.push(f.name);
      }
      await store.saveIdListHashes({ uid: seg.uid, workspaceId, sourceId: source.id, listName: seg.idList?.hashed?.listName ?? seg.id, uploadedAt: new Date().toISOString(), fileNames: names, hashes: [...set] });
      // A raw upload made before the hashes arrived was unverified: check it now.
      const raw = idListRecs.find((r) => r.uid === seg.uid && r.origin === 'upload');
      if (raw) {
        setBusy({ uid: seg.uid, message: `Re-checking ${n(raw.ids.length)} uploaded IDs against ${n(set.size)} hashes…` });
        const result = await pipeline().reconcileIdList({ rawCsv: raw.ids.join('\n'), hashes: [...set], count: seg.idList?.count });
        await store.saveIdList({ ...raw, fetchedAt: new Date().toISOString(), ids: result.ids, coverage: result.coverage });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const uploadRaw = async (seg: Segment, files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setError(undefined);
    setBusy({ uid: seg.uid, message: `Hashing the IDs in ${file.name}…` });
    try {
      const hashes = hashRecs.find((r) => r.uid === seg.uid)?.hashes;
      const result = await pipeline().reconcileIdList({ rawCsv: await file.text(), hashes, count: seg.idList?.count });
      if (result.ids.length === 0) throw new Error(`No usable IDs in ${file.name}: ${hashes ? 'none of them hash to an entry of the StatSig list' : 'the file is empty'}.`);
      await store.saveIdList({ uid: seg.uid, workspaceId, sourceId: source.id, fetchedAt: new Date().toISOString(), ids: result.ids, origin: 'upload', fileName: file.name, coverage: result.coverage });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-b border-line-soft px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">ID lists</span>
        <span className="text-xs text-fg-muted">
          {source.kind === 'config_spec'
            ? 'A config spec names large lists but ships their members only as hashes (get_id_lists). Upload those files, then a CSV of the raw IDs; the console hashes the IDs in your browser and reports coverage. Nothing leaves this machine.'
            : `Lists above ${ID_LIST_AUTO_MAX.toLocaleString()} IDs are not loaded automatically. Load them here (or upload a CSV export); above ${LIST_SEGMENT_MAX.toLocaleString()} IDs they migrate as LD big segments.`}
        </span>
      </div>
      {error && (
        <div className="mb-2">
          <Callout tone="red">{error}</Callout>
        </div>
      )}
      <ul className="divide-y divide-line-soft text-sm">
        {segments.map((seg) => {
          const rec = idListRecs.find((r) => r.uid === seg.uid);
          const hashes = hashRecs.find((r) => r.uid === seg.uid);
          const cov = rec?.coverage;
          const count = seg.idList?.count ?? rec?.ids.length;
          const pct = cov && cov.total ? Math.floor((cov.matched / cov.total) * 1000) / 10 : undefined;
          const big = (rec?.ids.length ?? count ?? 0) > LIST_SEGMENT_MAX;
          return (
            <li key={seg.uid} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-mono text-xs">{seg.id}</span>
              <span className="text-xs text-fg-muted">
                {n(count)} {seg.idType} IDs
              </span>
              {big && <Badge tone="violet" title={`Above LD's ${LIST_SEGMENT_MAX.toLocaleString()}-ID list limit: migrates as a big segment (CSV import, Enterprise)`}>big segment</Badge>}
              {!rec && seg.idList?.hashed && <Badge tone="amber">hashed: needs raw IDs</Badge>}
              {!rec && !seg.idList?.hashed && !seg.idList?.ids && <Badge tone="amber">not loaded</Badge>}
              {rec?.origin !== 'upload' && (rec || seg.idList?.ids) && <Badge tone="green">loaded</Badge>}
              {rec?.origin === 'upload' && cov && (
                <Badge tone={cov.verified ? (cov.missing === 0 ? 'green' : 'amber') : 'blue'} title={cov.verified ? `${n(cov.matched)} of ${n(cov.total)} hashes matched; ${n(cov.missing)} missing; ${n(cov.extra)} uploaded IDs not in the list` : 'No hash file uploaded: checked against the count only'}>
                  {cov.verified ? `reconciled ${pct}%` : `uploaded, unverified (${n(cov.matched)}/${n(cov.total)})`}
                </Badge>
              )}
              {hashes && (
                <span className="text-xs text-fg-muted" title={hashes.fileNames.join(', ')}>
                  {n(hashes.hashes.length)} hashes from {hashes.fileNames.length} file{hashes.fileNames.length === 1 ? '' : 's'}
                </span>
              )}
              {rec?.fileName && <span className="text-xs text-fg-muted">{rec.fileName}</span>}
              {busy?.uid === seg.uid && (
                <span className="flex items-center gap-1 text-xs text-fg-muted">
                  <Spinner /> {busy.message}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {seg.idList?.hashed && (
                  <>
                    <input ref={(el) => void (hashInput.current[seg.uid] = el)} type="file" multiple className="hidden" onChange={(e) => void uploadHashes(seg, e.target.files).then(() => (e.target.value = ''))} />
                    <Button variant="secondary" className="py-1 text-xs" disabled={!!busy} onClick={() => hashInput.current[seg.uid]?.click()} title="The get_id_lists file(s) for this list: one +hash or -hash per line. Several files apply oldest first.">
                      {hashes ? 'Add hash file' : 'Upload hash file'}
                    </Button>
                  </>
                )}
                <input ref={(el) => void (rawInput.current[seg.uid] = el)} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => void uploadRaw(seg, e.target.files).then(() => (e.target.value = ''))} />
                <Button variant="secondary" className="py-1 text-xs" disabled={!!busy} onClick={() => rawInput.current[seg.uid]?.click()} title="A CSV (first column) or one ID per line. Hashed in the browser and compared with the StatSig list.">
                  {rec?.origin === 'upload' ? 'Replace raw IDs' : 'Upload raw IDs'}
                </Button>
                {rec?.origin === 'upload' && (
                  <Button variant="ghost" className="py-1 text-xs" disabled={!!busy} onClick={() => void store.deleteIdList(seg.uid)}>
                    Remove
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {m.coverage && Object.keys(m.coverage).length > 0 && <p className="mt-2 text-xs text-fg-muted">Partial coverage is a decision (hashed_id_list) on the Decisions page: accept it to migrate the matched IDs, or upload a fuller CSV.</p>}
    </div>
  );
}
