import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { LdLockup, LdMark } from '../components/Brand.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';
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
    <div className="relative flex min-h-full flex-col overflow-hidden">
      {/* Brand glow: two soft fields in the base colors, restrained, strongest in dark mode. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[32rem] overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[28rem] w-[56rem] -translate-x-1/2 rounded-full bg-gradient-brand opacity-[0.07] blur-3xl dark:opacity-[0.18]" />
        <div className="absolute top-24 right-[-10rem] h-72 w-72 rounded-full bg-gradient-brand-cyan opacity-[0.05] blur-3xl dark:opacity-[0.12]" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-6 pt-6">
        <LdLockup className="h-7 w-auto text-logo" />
        <ThemeToggle />
      </header>

      <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-6 pt-16 pb-16">
        <div className="mb-12 max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.14em] text-fg-muted uppercase">StatSig → LaunchDarkly</p>
          <h1 className="mt-3 font-display text-5xl font-bold tracking-[-0.03em] text-fg sm:text-6xl">
            Migration <span className="text-gradient-brand">Console</span>
          </h1>
          <p className="mt-5 text-base leading-relaxed text-fg-muted">
            Reads your StatSig projects and compares them with one LaunchDarkly project, side by side. Every imperfect mapping becomes a decision you make once;
            nothing is dropped or approximated silently. Everything stays in this browser: no server, no account, and tokens are kept in memory only.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Card className="relative overflow-hidden p-6">
            <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-brand" />
            <h2 className="text-base font-semibold text-fg">Try the demo</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
              “Acme Retail”: two simulated StatSig projects (<code className="text-[13px] text-fg">acme-web</code>, <code className="text-[13px] text-fg">acme-mobile</code>) served by an
              in-browser mock of the Console API and read through the real adapters. No StatSig key needed.
            </p>
            <Button className="mt-5" onClick={tryDemo} disabled={busy}>
              {busy && <Spinner />} Try the demo
            </Button>
            {error && (
              <div className="mt-3">
                <Callout tone="red">{error}</Callout>
              </div>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-base font-semibold text-fg">New workspace</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">One LaunchDarkly project plus one or more StatSig sources: a read-only Console API key or an uploaded config spec.</p>
            <div className="mt-5">
              <Label htmlFor="ws-name">Name</Label>
              <Input id="ws-name" value={name} placeholder="e.g. Contoso migration" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
            </div>
            <Button className="mt-4" variant="secondary" onClick={create}>
              Create workspace
            </Button>
          </Card>
        </div>

        {workspaces && workspaces.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-3 text-xs font-semibold tracking-wide text-fg-muted uppercase">Workspaces in this browser</h2>
            <Card>
              <ul className="divide-y divide-line-soft">
                {workspaces.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-surface-hover">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-fg">{w.name}</span>
                      {w.isDemo && <Badge tone="violet">demo</Badge>}
                      {w.ld?.projectKey && <Badge tone="blue">LD · {w.ld.projectKey}</Badge>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-fg-subtle">updated {new Date(w.updatedAt).toLocaleString()}</span>
                      <Button variant="secondary" className="py-1.5" onClick={() => (w.isDemo ? tryDemo() : onOpen(w.id))}>
                        Open
                      </Button>
                      <Button variant="ghost" className="py-1.5" onClick={() => store.deleteWorkspace(w.id)} title="Delete this workspace's local data">
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}
      </main>

      <footer className="relative z-10 border-t border-line-soft">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4 text-xs text-fg-subtle">
          <span className="flex items-center gap-2">
            <LdMark className="h-3.5 w-3.5 text-logo" />A LaunchDarkly tool
          </span>
          <span>One-way: StatSig is only ever read.</span>
          <span>Syncs run only when you ask.</span>
          <span className="ml-auto">Tokens never leave this tab.</span>
        </div>
      </footer>
    </div>
  );
}
