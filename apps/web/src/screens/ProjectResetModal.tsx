import { useRef, useState } from 'react';
import { Badge, Button, Callout, Card, CloseButton, Input, Spinner } from '../components/ui.tsx';
import type { LdSession } from '../lib/ld.ts';
import { resetLdProject, type ResetProgress, type ResetReport } from '../lib/reset.ts';

/**
 * Three typed confirmations before the LD project is wiped (lib/reset.ts). The phrases are
 * exact, case-insensitive on the first two, and each gate explains what is about to happen, so
 * nobody gets here by accident or by muscle memory.
 */
const GATES = [
  {
    phrase: 'yes',
    title: 'Reset this LaunchDarkly project?',
    body: 'This deletes every flag, segment and metric in the project, archives every experiment and custom context kind, and removes the environments this console created. StatSig is not touched. LaunchDarkly keeps an audit log, but there is no undo for a deleted flag.',
    prompt: 'Type “yes” to continue to the second of three confirmations.',
  },
  {
    phrase: "yes i'm really sure",
    title: 'Still here? Good, because this is the part where we get serious.',
    body: 'Yeah, we really are going to make you type things three times to make absolutely sure you want to set this project to the state it was in on day 0. Everyone who uses this project will see empty flag lists the moment this finishes.',
    prompt: 'Type “yes i’m really sure” (apostrophe optional) to reach the final confirmation.',
  },
  {
    phrase: 'engage project reset',
    title: 'Final confirmation: engage project reset.',
    body: 'Last chance to close this dialog and go for a walk instead. If you proceed, the console will delete and archive everything in the project named below, one request at a time, and show you what LaunchDarkly refused.',
    prompt: 'Type “engage project reset” to begin. The button lights up only when the phrase matches exactly.',
  },
] as const;

const normalize = (s: string) => s.trim().toLowerCase().replace(/[’‘`]/g, "'");

type Phase = { kind: 'confirm'; step: number } | { kind: 'running'; progress?: ResetProgress; cancelling?: boolean } | { kind: 'done'; report: ResetReport } | { kind: 'error'; message: string };

export function ProjectResetModal({ workspaceId, ld, onClose }: { workspaceId: string; ld: LdSession; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm', step: 0 });
  const [typed, setTyped] = useState('');
  // Cancels the reset in progress: the request in flight finishes, nothing else is deleted.
  const controller = useRef<AbortController>(null);
  const gate = phase.kind === 'confirm' ? GATES[phase.step]! : undefined;
  const matches = gate ? normalize(typed) === normalize(gate.phrase) : false;

  const cancel = () => {
    controller.current?.abort(new DOMException('Cancelled by the user.', 'AbortError'));
    setPhase((p) => (p.kind === 'running' ? { ...p, cancelling: true } : p));
  };

  const next = async () => {
    if (phase.kind !== 'confirm' || !matches) return;
    if (phase.step < GATES.length - 1) {
      setPhase({ kind: 'confirm', step: phase.step + 1 });
      setTyped('');
      return;
    }
    const ctrl = new AbortController();
    controller.current = ctrl;
    setPhase({ kind: 'running' });
    try {
      const report = await resetLdProject(workspaceId, ld, (progress) => setPhase((p) => ({ kind: 'running', progress, ...(p.kind === 'running' && p.cancelling ? { cancelling: true } : {}) })), ctrl.signal);
      setPhase({ kind: 'done', report });
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
    } finally {
      controller.current = null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Reset LaunchDarkly project">
      <Card className="flex w-full max-w-xl flex-col overflow-hidden border-error-line/60 shadow-raised">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3">
          <Badge tone="red">danger</Badge>
          <h2 className="font-display text-lg font-semibold tracking-tight">Reset LD project “{ld.projectKey}”</h2>
          {phase.kind === 'confirm' && (
            <span className="text-xs text-fg-muted">
              confirmation {phase.step + 1} of {GATES.length}
            </span>
          )}
          <CloseButton onClick={onClose} disabled={phase.kind === 'running'} className="ml-auto" />
        </header>
        <div className="space-y-4 p-5">
          {gate && phase.kind === 'confirm' && (
            <>
              <h3 className="text-base font-semibold">{gate.title}</h3>
              <p className="text-sm text-fg-muted">{gate.body}</p>
              <ol className="flex gap-2 text-xs text-fg-subtle">
                {GATES.map((g, i) => (
                  <li key={g.phrase} className={i < phase.step ? 'text-success' : i === phase.step ? 'text-fg' : ''}>
                    {i < phase.step ? '✓' : `${i + 1}.`} “{g.phrase}”
                  </li>
                ))}
              </ol>
              <label className="block text-sm">
                {gate.prompt}
                <Input
                  autoFocus
                  className="mt-2 w-full font-mono"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void next()}
                  aria-label={`Type ${gate.phrase} to confirm`}
                  placeholder={gate.phrase}
                />
              </label>
            </>
          )}
          {phase.kind === 'running' && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Spinner /> {phase.progress?.phase ?? 'Starting…'}
                {phase.progress && phase.progress.total > 0 && (
                  <span className="text-fg-muted">
                    {phase.progress.done}/{phase.progress.total}
                  </span>
                )}
              </div>
              {phase.progress?.message && <div className="font-mono text-xs text-fg-muted">{phase.progress.message}</div>}
              <div className="h-1.5 overflow-hidden rounded bg-surface-2">
                <div className="h-full bg-error-fill transition-all" style={{ width: `${phase.progress && phase.progress.total ? (phase.progress.done / phase.progress.total) * 100 : 5}%` }} />
              </div>
              <p className="text-xs text-fg-subtle">
                {phase.cancelling ? 'Cancelling: the request in flight finishes, then nothing else is deleted.' : 'Keep this tab open until it finishes. Cancel stops after the current request; what is already deleted stays deleted.'}
              </p>
            </div>
          )}
          {phase.kind === 'done' && (
            <>
              <Callout tone={phase.report.cancelled || phase.report.failures.length ? 'amber' : 'green'}>
                {phase.report.cancelled ? 'Reset cancelled; the project still holds whatever was not reached. Before the stop it deleted' : 'Project reset. Deleted'} {phase.report.deleted.flags} flags, {phase.report.deleted.segments} segments, {phase.report.deleted.metrics} metrics and{' '}
                {phase.report.deleted.environments} environments; archived {phase.report.archived.experiments} experiments and {phase.report.archived.contextKinds} context kinds.
                {phase.report.failures.length > 0 && ` LaunchDarkly refused ${phase.report.failures.length} operation${phase.report.failures.length === 1 ? '' : 's'}:`}
              </Callout>
              {phase.report.failures.length > 0 && (
                <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                  {phase.report.failures.map((f, i) => (
                    <li key={i}>
                      <span className="font-mono">{f.what}</span> <span className="text-fg-muted">· {f.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-fg-muted">Runs recorded in this browser still list what they wrote; their undo will find nothing to restore.</p>
            </>
          )}
          {phase.kind === 'error' && <Callout tone="red">{phase.message}</Callout>}
        </div>
        <footer className="flex items-center gap-3 border-t border-line bg-surface-2 px-5 py-3">
          {phase.kind === 'confirm' && (
            <>
              <Button variant="secondary" onClick={onClose}>
                Keep my project
              </Button>
              <Button variant="danger" className="ml-auto" disabled={!matches} onClick={() => void next()}>
                {phase.step < GATES.length - 1 ? 'Continue' : 'Engage project reset'}
              </Button>
            </>
          )}
          {phase.kind === 'running' && (
            <Button variant="secondary" className="ml-auto" disabled={phase.cancelling} onClick={cancel}>
              {phase.cancelling ? 'Cancelling…' : 'Cancel reset'}
            </Button>
          )}
          {(phase.kind === 'done' || phase.kind === 'error') && (
            <Button className="ml-auto" onClick={onClose}>
              Close
            </Button>
          )}
        </footer>
      </Card>
    </div>
  );
}
