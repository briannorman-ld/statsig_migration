import { useState } from 'react';
import { ENTITY_KINDS, type EntityKind } from '@sslm/canonical';
import { STATSIG_CONSOLE_BASE_URL } from '@sslm/statsig-client';
import { appendLog, describeProgress, describeTransportEvent, SyncActivity, type SyncLogEntry } from '../components/SyncActivity.tsx';
import { Button, Callout, Card, Input, Label, Spinner } from '../components/ui.tsx';
import { KIND_LABEL } from '../lib/kinds.ts';
import { secrets } from '../lib/secrets.ts';
import { store } from '../lib/store.ts';
import { syncConsoleSource, uploadSpec } from '../lib/sync.ts';

/** Add a StatSig source: Console API key (recommended) or an uploaded config spec (PLAN §4.2). */
export function AddSource({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const [kind, setKind] = useState<'console_api' | 'config_spec'>('console_api');
  const [label, setLabel] = useState('');
  const [alias, setAlias] = useState('');
  const [key, setKey] = useState('');
  const [file, setFile] = useState<File>();
  const [kinds, setKinds] = useState<Set<EntityKind>>(() => new Set(ENTITY_KINDS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [log, setLog] = useState<SyncLogEntry[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; endpoint: string }>();

  const add = async () => {
    setBusy(true);
    setError(undefined);
    setLog([]);
    setProgress(undefined);
    const push = (e: SyncLogEntry) => setLog((l) => appendLog(l, e));
    const a = (alias || label || 'src').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 24);
    // Only Console API sources have a crawl scope; a spec file already holds whatever it holds.
    const scope = kind === 'console_api' && kinds.size < ENTITY_KINDS.length ? { resources: ENTITY_KINDS.filter((k) => kinds.has(k)) } : {};
    const source = { id: crypto.randomUUID(), alias: a, label: label || a, kind, createdAt: new Date().toISOString(), ...(kind === 'console_api' ? { baseUrl: STATSIG_CONSOLE_BASE_URL, ...scope } : {}) };
    try {
      await store.addSource(workspaceId, source);
      if (kind === 'console_api') {
        secrets.set('statsig', source.id, key.trim());
        setKey('');
        await syncConsoleSource(workspaceId, source, {
          onProgress: (p) => {
            setProgress(p);
            push(describeProgress(p));
          },
          onTransport: (e) => push(describeTransportEvent(e)),
        });
      } else if (file) {
        await uploadSpec(workspaceId, source, file);
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <h2 className="font-display text-xl font-semibold tracking-tight">Add a StatSig source</h2>
      <div className="flex gap-2">
        <Button variant={kind === 'console_api' ? 'primary' : 'secondary'} onClick={() => setKind('console_api')}>
          Console API key (recommended)
        </Button>
        <Button variant={kind === 'config_spec' ? 'primary' : 'secondary'} onClick={() => setKind('config_spec')}>
          Upload config spec
        </Button>
      </div>
      <Card className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="src-label">Name</Label>
            <Input id="src-label" value={label} placeholder="acme-web" onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="src-alias">Alias (prefix for consolidation)</Label>
            <Input id="src-alias" value={alias} placeholder="web" onChange={(e) => setAlias(e.target.value)} />
          </div>
        </div>
        {kind === 'console_api' ? (
          <>
            <div>
              <Label htmlFor="src-key">Console API key (read-only)</Label>
              <Input id="src-key" type="password" autoComplete="off" spellCheck={false} placeholder="console-…" value={key} onChange={(e) => setKey(e.target.value)} />
              <p className="mt-1.5 text-xs text-fg-muted">
                Kept in memory only and sent only to statsigapi.net. A Console API key belongs to <b>one StatSig project</b> (StatSig has no API that lists an
                organization’s projects), so add one source per project; several sources consolidate into this workspace’s single LaunchDarkly project.
              </p>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">Resources to read</legend>
              <p className="mb-2 text-xs text-fg-muted">
                Uncheck what you don’t plan to migrate; each kind is one or more paged requests, so a smaller scope syncs faster. Gates reference segments, so keep
                segments when you keep gates. You can add the same project again later with a wider scope.
              </p>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
                {ENTITY_KINDS.map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={kinds.has(k)}
                      onChange={(e) =>
                        setKinds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(k);
                          else next.delete(k);
                          return next;
                        })
                      }
                    />
                    {KIND_LABEL[k]}
                  </label>
                ))}
              </div>
              <div className="mt-2 flex gap-3 text-xs">
                <button type="button" className="text-link hover:underline" onClick={() => setKinds(new Set(ENTITY_KINDS))}>
                  Select all
                </button>
                <button type="button" className="text-link hover:underline" onClick={() => setKinds(new Set<EntityKind>(['gate', 'segment']))}>
                  Gates and segments only
                </button>
              </div>
              {kinds.size === 0 && <p className="mt-1.5 text-xs text-error">Pick at least one resource kind.</p>}
            </fieldset>
            <p className="text-xs text-fg-muted">
              The browser talks to the StatSig Console API directly; no relay or server sits in between. The key is used read-only and nothing is written to StatSig.
            </p>
          </>
        ) : (
          <div>
            <Label htmlFor="src-file">Config spec file (.json, .json.gz)</Label>
            <input id="src-file" type="file" accept=".json,.gz,.br,application/json" onChange={(e) => setFile(e.target.files?.[0])} className="text-sm" />
            <p className="mt-1.5 text-xs text-fg-muted">
              Fetch with <code>curl -o spec.json "https://api.statsigcdn.com/v2/download_config_specs/&lt;CLIENT_KEY&gt;.json"</code> using a client key that has only the
              “Allow Download Config Specs” scope and covers all environments and target apps. The file stays in this browser.
            </p>
          </div>
        )}
        {error && <Callout tone="red">{error}</Callout>}
        <div className="flex items-center gap-3">
          <Button onClick={add} disabled={busy || (kind === 'console_api' ? !key || kinds.size === 0 : !file)}>
            {busy && <Spinner />} {busy && kind === 'console_api' ? 'Syncing…' : 'Add source'}
          </Button>
          {busy && progress && (
            <span className="text-xs text-fg-muted tabular-nums">
              {progress.done}/{progress.total} · {progress.endpoint}
            </span>
          )}
        </div>
        {kind === 'console_api' && (busy || (error && log.length > 0)) && <SyncActivity log={log} running={busy} />}
      </Card>
    </div>
  );
}
