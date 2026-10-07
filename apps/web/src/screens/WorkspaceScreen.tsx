import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { countsByKind, ENTITY_KINDS, type CanonicalSnapshot, type EntityKind } from '@sslm/canonical';
import type { SourceRecord } from '@sslm/store';
import { Badge, Button, Callout, cx, Select, Spinner } from '../components/ui.tsx';
import { useLdSession } from '../lib/ld.ts';
import { store } from '../lib/store.ts';
import { syncConsoleSource } from '../lib/sync.ts';
import { AddSource } from './AddSource.tsx';
import { EntityList } from './EntityList.tsx';
import { GatesSideBySide } from './GatesSideBySide.tsx';
import { LdPanel } from './LdPanel.tsx';
import { WarningsView } from './WarningsView.tsx';

export type View = { kind: 'resource'; resource: EntityKind } | { kind: 'ld' } | { kind: 'warnings' } | { kind: 'add-source' };

const KIND_LABEL: Record<EntityKind, string> = {
  gate: 'Gates',
  config: 'Dynamic configs',
  segment: 'Segments',
  experiment: 'Experiments',
  layer: 'Layers',
  holdout: 'Holdouts',
  autotune: 'Autotunes',
  metric: 'Metrics',
  param_store: 'Param stores',
};

interface SyncState {
  running: boolean;
  done?: number;
  total?: number;
  endpoint?: string;
  retries: string[];
  error?: string;
}

export function WorkspaceScreen({ workspaceId, onExit }: { workspaceId: string; onExit: () => void }) {
  const workspace = useLiveQuery(() => store.getWorkspace(workspaceId), [workspaceId]);
  const sources = useLiveQuery(() => store.listSources(workspaceId), [workspaceId]);
  const snapshots = useLiveQuery(
    async () => {
      const out: Record<string, CanonicalSnapshot | undefined> = {};
      for (const s of sources ?? []) out[s.id] = (await store.latestSnapshot(s.id))?.canonical;
      return out;
    },
    [sources],
  );
  const [view, setView] = useState<View>({ kind: 'resource', resource: 'gate' });
  const [env, setEnv] = useState<string>('');
  const [sync, setSync] = useState<Record<string, SyncState>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const ld = useLdSession(workspaceId);
  const autoSynced = useRef(new Set<string>());

  const runSync = async (s: SourceRecord) => {
    setSync((x) => ({ ...x, [s.id]: { running: true, retries: [] } }));
    try {
      await syncConsoleSource(workspaceId, s, {
        onProgress: (p) => setSync((x) => ({ ...x, [s.id]: { ...(x[s.id] ?? { retries: [] }), running: true, done: p.done, total: p.total, endpoint: p.endpoint } })),
        onRetry: (m) => setSync((x) => ({ ...x, [s.id]: { ...(x[s.id] ?? { running: true }), retries: [...(x[s.id]?.retries ?? []), m].slice(-4) } as SyncState })),
      });
      setSync((x) => ({ ...x, [s.id]: { running: false, retries: x[s.id]?.retries ?? [] } }));
    } catch (e) {
      setSync((x) => ({ ...x, [s.id]: { running: false, retries: x[s.id]?.retries ?? [], error: (e as Error).message } }));
    }
  };

  // First open of a demo workspace: sync every Console API source that has no snapshot yet.
  useEffect(() => {
    if (!sources || !snapshots) return;
    for (const s of sources) {
      if (s.kind === 'console_api' && s.isDemo && !snapshots[s.id] && !autoSynced.current.has(s.id)) {
        autoSynced.current.add(s.id);
        void runSync(s);
      }
    }
  }, [sources, snapshots]);

  const visible = useMemo(() => (sources ?? []).filter((s) => !hidden.has(s.id) && snapshots?.[s.id]), [sources, snapshots, hidden]);
  const visibleSnaps = visible.map((s) => snapshots![s.id]!);
  const envs = useMemo(() => {
    const names = new Set<string>();
    for (const sn of visibleSnaps) for (const e of sn.environments) names.add(e.name);
    return [...names];
  }, [visibleSnaps]);
  useEffect(() => {
    if (envs.length && !envs.includes(env)) setEnv(envs.includes('production') ? 'production' : envs[0]!);
  }, [envs, env]);

  const counts = useMemo(() => {
    const out = Object.fromEntries(ENTITY_KINDS.map((k) => [k, 0])) as Record<EntityKind, number>;
    for (const sn of visibleSnaps) {
      const c = countsByKind(sn);
      for (const k of ENTITY_KINDS) out[k] += c[k];
    }
    return out;
  }, [visibleSnaps]);
  const warningCount = visibleSnaps.reduce((n, s) => n + s.warnings.length, 0);

  if (!workspace) return <div className="p-8 text-slate-500">Loading…</div>;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2.5">
        <Button variant="ghost" onClick={onExit} className="px-2">
          ← Workspaces
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="font-semibold">{workspace.name}</h1>
          {workspace.isDemo && <Badge tone="violet">demo</Badge>}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Environment
            <Select value={env} onChange={(e) => setEnv(e.target.value)} disabled={!envs.length} aria-label="Environment">
              {envs.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </Select>
          </label>
          <button onClick={() => setView({ kind: 'ld' })} className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm hover:bg-slate-50">
            <span className={cx('h-2 w-2 rounded-full', ld.status === 'connected' ? 'bg-emerald-500' : ld.status === 'error' ? 'bg-red-500' : 'bg-slate-300')} />
            {ld.status === 'connected' ? (ld.projectKey ? `LD · ${ld.projectKey}` : 'LD · choose project') : 'Connect LaunchDarkly'}
            {ld.matrix && <Badge tone="blue">{ld.matrix.capabilities.filter((c) => c.status === 'available').length} capabilities</Badge>}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3" aria-label="Workspace">
          <SectionTitle>StatSig sources</SectionTitle>
          <ul className="space-y-1.5">
            {(sources ?? []).map((s) => {
              const sn = snapshots?.[s.id];
              const st = sync[s.id];
              return (
                <li key={s.id} className="rounded-md border border-slate-200 p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={!hidden.has(s.id)} aria-label={`Include ${s.label}`} onChange={() => setHidden((h) => toggle(h, s.id))} />
                    <span className="font-medium">{s.label}</span>
                    <Badge tone={s.kind === 'console_api' ? 'green' : 'amber'}>{s.kind === 'console_api' ? 'Console API' : 'Spec'}</Badge>
                    {s.kind === 'console_api' && (
                      <button className="ml-auto text-slate-500 hover:text-slate-900 disabled:opacity-40" title="Refresh from StatSig" disabled={st?.running} onClick={() => runSync(s)}>
                        ↻
                      </button>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {st?.running ? (
                      <span className="flex items-center gap-1.5">
                        <Spinner /> {st.done ?? 0}/{st.total ?? '…'} {st.endpoint}
                      </span>
                    ) : sn ? (
                      <>synced {timeAgo(sn.takenAt)}{sn.isWarehouseNative ? ' · Warehouse Native' : ''}</>
                    ) : (
                      'not synced'
                    )}
                  </div>
                  {st?.running && st.retries.length > 0 && <div className="mt-1 text-xs text-amber-700">{st.retries[st.retries.length - 1]}</div>}
                  {st?.error && <div className="mt-1 text-xs text-red-700">{st.error}</div>}
                </li>
              );
            })}
          </ul>
          <Button variant="ghost" className="mt-1.5 w-full justify-start text-sm" onClick={() => setView({ kind: 'add-source' })}>
            + Add source
          </Button>

          <SectionTitle>Resources</SectionTitle>
          <ul>
            {ENTITY_KINDS.map((k) => (
              <li key={k}>
                <NavItem active={view.kind === 'resource' && view.resource === k} onClick={() => setView({ kind: 'resource', resource: k })}>
                  <span>{KIND_LABEL[k]}</span>
                  <span className="text-slate-500 tabular-nums">{counts[k]}</span>
                </NavItem>
              </li>
            ))}
          </ul>

          <SectionTitle>Workspace</SectionTitle>
          <NavItem active={view.kind === 'ld'} onClick={() => setView({ kind: 'ld' })}>
            <span>LaunchDarkly & capabilities</span>
          </NavItem>
          <NavItem active={view.kind === 'warnings'} onClick={() => setView({ kind: 'warnings' })}>
            <span>Source warnings</span>
            {warningCount > 0 && <Badge tone="amber">{warningCount}</Badge>}
          </NavItem>
          <p className="mt-6 px-2 text-xs text-slate-400">Decisions, waves and migration arrive in M3+.</p>
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto p-5">
          {visible.length === 0 && view.kind === 'resource' && (
            <Callout tone="blue">{(sources ?? []).length === 0 ? 'Add a StatSig source to get started.' : 'Waiting for the first sync…'}</Callout>
          )}
          {view.kind === 'resource' && visible.length > 0 &&
            (view.resource === 'gate' ? (
              <GatesSideBySide workspaceId={workspaceId} sources={visible} snapshots={snapshots ?? {}} env={env} />
            ) : (
              <EntityList kind={view.resource} label={KIND_LABEL[view.resource]} sources={visible} snapshots={snapshots ?? {}} />
            ))}
          {view.kind === 'ld' && <LdPanel workspaceId={workspaceId} workspace={workspace} />}
          {view.kind === 'warnings' && <WarningsView sources={visible} snapshots={snapshots ?? {}} />}
          {view.kind === 'add-source' && <AddSource workspaceId={workspaceId} onDone={() => setView({ kind: 'resource', resource: 'gate' })} />}
        </main>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-4 mb-1.5 px-2 text-xs font-semibold tracking-wide text-slate-500 uppercase first:mt-0">{children}</h2>;
}

function NavItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm', active ? 'bg-slate-900 text-white' : 'hover:bg-slate-100')}>
      {children}
    </button>
  );
}

function toggle(set: Set<string>, id: string): Set<string> {
  const n = new Set(set);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
