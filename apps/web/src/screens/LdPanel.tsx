import { useState } from 'react';
import { LD_INSTANCES, type CapabilityStatus, type LdInstanceId } from '@sslm/ld-client';
import type { WorkspaceRecord } from '@sslm/store';
import { Badge, Button, Callout, Card, cx, Input, Label, Modal, Select, Spinner } from '../components/ui.tsx';
import { chooseProject, connectLd, disconnectLd, reprobe, useLdSession } from '../lib/ld.ts';
import { DEMO_LD_PROJECT } from '../lib/demo.ts';
import { store } from '../lib/store.ts';

const STATUS_TONE: Record<CapabilityStatus, 'green' | 'amber' | 'red' | 'slate' | 'violet'> = {
  available: 'green',
  not_permitted: 'red',
  unavailable: 'amber',
  unknown: 'slate',
  manual: 'violet',
};

export function LdPanel({ workspaceId, workspace }: { workspaceId: string; workspace: WorkspaceRecord }) {
  const ld = useLdSession(workspaceId);
  const [instance, setInstance] = useState<LdInstanceId>(workspace.ld?.instance ?? 'us');
  const [token, setToken] = useState('');
  const [pendingAck, setPendingAck] = useState<LdInstanceId>();
  const acked = (id: LdInstanceId) => id === 'us' || workspace.instanceAcknowledgement?.instance === id;
  const disclaimer = LD_INSTANCES[instance].disclaimer;

  const pickInstance = (id: LdInstanceId) => {
    setInstance(id);
    if (!acked(id)) setPendingAck(id);
  };

  const connect = async () => {
    const t = token.trim();
    setToken(''); // don't keep the token in React state longer than needed
    await connectLd(workspaceId, instance, t);
  };

  return (
    <div className="max-w-4xl space-y-5">
      <h2 className="font-display text-xl font-semibold tracking-tight">LaunchDarkly</h2>

      {disclaimer && acked(instance) && (
        <Callout>
          <b>{disclaimer.title}:</b> {disclaimer.body.join(' ')}
        </Callout>
      )}

      {ld.status !== 'connected' ? (
        <Card className="space-y-4 p-5">
          <fieldset>
            <Label>Instance</Label>
            <div className="flex flex-wrap gap-2">
              {Object.values(LD_INSTANCES).map((i) => (
                <button
                  key={i.id}
                  onClick={() => pickInstance(i.id)}
                  className={cx('rounded-md border px-3 py-2 text-left text-sm transition-colors', instance === i.id ? 'border-selected-line bg-selected text-selected-fg shadow-card' : 'border-line hover:border-line-strong hover:bg-surface-hover')}
                >
                  <div className="font-medium">{i.label}</div>
                  <div className={cx('font-mono text-xs', instance === i.id ? 'text-selected-fg/70' : 'text-fg-muted')}>{i.origin.replace('https://', '')}</div>
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <Label htmlFor="ld-token">Access token</Label>
            <Input
              id="ld-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="api-…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && token && acked(instance) && void connect()}
            />
            <p className="mt-1.5 text-xs text-fg-muted">
              Kept in memory only and sent only to {LD_INSTANCES[instance].origin}. Closing the tab forgets it. A Writer service token is recommended; this milestone only
              reads.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={connect} disabled={!token || ld.status === 'connecting' || !acked(instance)}>
              {ld.status === 'connecting' && <Spinner />} Connect
            </Button>
            {!acked(instance) && <span className="text-sm text-warning">Acknowledge the {LD_INSTANCES[instance].label} notice first.</span>}
          </div>
          {ld.error && <Callout tone="red">{ld.error}</Callout>}
        </Card>
      ) : (
        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-success-fill" />
            Connected to <b>{LD_INSTANCES[ld.instance!].label}</b>
            {ld.identity?.tokenName && <Badge>{ld.identity.tokenName}</Badge>}
            <Badge tone={ld.identity?.serviceToken ? 'green' : 'amber'}>{ld.identity?.serviceToken ? 'service token' : 'personal token'}</Badge>
            <Button variant="ghost" className="ml-auto" onClick={() => disconnectLd(workspaceId)}>
              Disconnect
            </Button>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <Label htmlFor="ld-project">Target project</Label>
              <Select id="ld-project" value={ld.projectKey ?? ''} onChange={(e) => e.target.value && void chooseProject(workspaceId, e.target.value)}>
                <option value="">Choose a project…</option>
                {(ld.projects ?? []).map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </Select>
            </div>
            {ld.projectKey && (
              <Button variant="secondary" onClick={() => reprobe(workspaceId)} disabled={!!ld.probing}>
                Re-probe
              </Button>
            )}
            {ld.probing && (
              <span className="flex items-center gap-2 pb-2 text-sm text-fg-muted">
                <Spinner /> {ld.probing}
              </span>
            )}
          </div>
          {workspace.isDemo && (
            <Callout tone="blue">
              Demo target: <code>{DEMO_LD_PROJECT.projectKey}</code>, an existing project. Later milestones write only resources tagged{' '}
              <code>statsig-migrated</code> there, and “Reset demo” only ever removes those.
            </Callout>
          )}
          {ld.error && <Callout tone="red">{ld.error}</Callout>}
        </Card>
      )}

      {ld.matrix && (
        <Card className="overflow-hidden">
          <div className="border-b border-line-soft px-4 py-3">
            <h3 className="font-semibold">Capability matrix</h3>
            <p className="text-xs text-fg-muted">
              {ld.matrix.projectName} · probed {new Date(ld.matrix.probedAt).toLocaleTimeString()} with read-only requests (PLAN §5.2). “Unknown” items are confirmed by
              the first write that needs them.
            </p>
            {ld.matrix.tokenInfo.warnings.map((w) => (
              <div key={w} className="mt-2">
                <Callout>{w}</Callout>
              </div>
            ))}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs font-semibold tracking-wide text-fg-muted uppercase">
              <tr>
                <th className="px-3 py-2">Capability</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Typical requirement</th>
                <th className="px-3 py-2">Fallback</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {ld.matrix.capabilities.map((c) => (
                <tr key={c.key} className="align-top">
                  <td className="px-3 py-2 font-medium">{c.label}</td>
                  <td className="px-3 py-2" title={c.evidence}>
                    <Badge tone={STATUS_TONE[c.status]}>{c.status.replace('_', ' ')}</Badge>
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{c.requirement}</td>
                  <td className="px-3 py-2 text-fg-muted">{c.fallback}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-line-soft px-4 py-3">
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">Environments</h4>
            <div className="flex flex-wrap gap-2">
              {ld.matrix.environments.map((e) => (
                <span key={e.key} className="rounded-md border border-line px-2 py-1 text-xs">
                  <b>{e.key}</b>
                  {e.critical && ' · critical'}
                  {e.flagApprovalsRequired && ' · flag approvals'}
                  {e.segmentApprovalsRequired && ' · segment approvals'}
                </span>
              ))}
            </div>
          </div>
        </Card>
      )}

      {pendingAck && LD_INSTANCES[pendingAck].disclaimer && (
        <Modal title={LD_INSTANCES[pendingAck].disclaimer!.title} onClose={() => { setPendingAck(undefined); setInstance('us'); }}>
          <div className="space-y-2 text-sm text-fg-muted">
            {LD_INSTANCES[pendingAck].disclaimer!.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setPendingAck(undefined); setInstance('us'); }}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                await store.updateWorkspace(workspaceId, { instanceAcknowledgement: { instance: pendingAck as 'eu' | 'federal', acknowledgedAt: new Date().toISOString() } });
                setPendingAck(undefined);
              }}
            >
              I understand
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
