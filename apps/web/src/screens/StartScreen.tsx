import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Badge, Button, Callout, Card, Input, Label, Spinner } from '../components/ui.tsx';
import { ensureDemoWorkspace, startDemoMock } from '../lib/demo.ts';
import { store } from '../lib/store.ts';

export function StartScreen({ onOpen }: { onOpen: (workspaceId: string) => void }) {
  const workspaces = useLiveQuery(() => store.listWorkspaces(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [name, setName] = useState('');

  const tryDemo = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await startDemoMock();
      onOpen(await ensureDemoWorkspace());
    } catch (e) {
      setError(`Could not start the demo: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const ws = await store.createWorkspace({ name: name.trim() || 'Untitled workspace' });
    onOpen(ws.id);
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="mb-10">
        <p className="text-sm font-semibold tracking-wide text-slate-500 uppercase">StatSig → LaunchDarkly</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Migration Console</h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Reads your StatSig projects and compares them with one LaunchDarkly project, side by side. Everything stays in this browser: there is no server, no account,
          and tokens are kept in memory only.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Try the demo</h2>
          <p className="mt-1 text-sm text-slate-600">
            “Acme Retail”: two simulated StatSig projects (<code>acme-web</code>, <code>acme-mobile</code>) served by an in-browser mock of the Console API, read through
            the real adapters. No StatSig key needed.
          </p>
          <Button className="mt-4" onClick={tryDemo} disabled={busy}>
            {busy && <Spinner />} Try the demo
          </Button>
          {error && (
            <div className="mt-3">
              <Callout tone="red">{error}</Callout>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold">New workspace</h2>
          <p className="mt-1 text-sm text-slate-600">One LaunchDarkly project plus one or more StatSig sources (Console API key or uploaded config spec).</p>
          <div className="mt-4">
            <Label htmlFor="ws-name">Name</Label>
            <Input id="ws-name" value={name} placeholder="e.g. Contoso migration" onChange={(e) => setName(e.target.value)} />
          </div>
          <Button className="mt-4" variant="secondary" onClick={create}>
            Create workspace
          </Button>
        </Card>
      </div>

      {workspaces && workspaces.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">Workspaces in this browser</h2>
          <Card>
            <ul className="divide-y divide-slate-100">
              {workspaces.map((w) => (
                <li key={w.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{w.name}</span>
                    {w.isDemo && <Badge tone="violet">demo</Badge>}
                    {w.ld?.projectKey && <Badge tone="blue">LD: {w.ld.projectKey}</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">updated {new Date(w.updatedAt).toLocaleString()}</span>
                    <Button variant="secondary" onClick={() => (w.isDemo ? tryDemo() : onOpen(w.id))}>
                      Open
                    </Button>
                    <Button variant="ghost" onClick={() => store.deleteWorkspace(w.id)} title="Delete this workspace's local data">
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
