import { useState } from 'react';
import { STATSIG_CONSOLE_BASE_URL } from '@sslm/statsig-client';
import { Button, Callout, Card, Input, Label, Spinner } from '../components/ui.tsx';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const add = async () => {
    setBusy(true);
    setError(undefined);
    const a = (alias || label || 'src').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 24);
    const source = { id: crypto.randomUUID(), alias: a, label: label || a, kind, createdAt: new Date().toISOString(), ...(kind === 'console_api' ? { baseUrl: STATSIG_CONSOLE_BASE_URL } : {}) };
    try {
      await store.addSource(workspaceId, source);
      if (kind === 'console_api') {
        secrets.set('statsig', source.id, key.trim());
        setKey('');
        await syncConsoleSource(workspaceId, source);
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
      <h2 className="text-lg font-semibold">Add a StatSig source</h2>
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
              <p className="mt-1.5 text-xs text-slate-500">Kept in memory only and sent only to statsigapi.net.</p>
            </div>
            <Callout>
              Not yet verified: whether StatSig allows browser access to the Console API (M0 spike #1). If it doesn’t, this fails with “StatSig unreachable” and the
              stateless relay is needed. Config-spec upload works regardless.
            </Callout>
          </>
        ) : (
          <div>
            <Label htmlFor="src-file">Config spec file (.json, .json.gz)</Label>
            <input id="src-file" type="file" accept=".json,.gz,.br,application/json" onChange={(e) => setFile(e.target.files?.[0])} className="text-sm" />
            <p className="mt-1.5 text-xs text-slate-500">
              Fetch with <code>curl -o spec.json "https://api.statsigcdn.com/v2/download_config_specs/&lt;CLIENT_KEY&gt;.json"</code> using a client key that has only the
              “Allow Download Config Specs” scope and covers all environments and target apps. The file stays in this browser.
            </p>
          </div>
        )}
        {error && <Callout tone="red">{error}</Callout>}
        <Button onClick={add} disabled={busy || (kind === 'console_api' ? !key : !file)}>
          {busy && <Spinner />} Add source
        </Button>
      </Card>
    </div>
  );
}
