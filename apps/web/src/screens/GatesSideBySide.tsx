import { Fragment, useEffect, useMemo, useState } from 'react';
import { matchAcrossSources, overridesForEnvironment, resolveRulesForEnvironment, type CanonicalSnapshot, type Gate } from '@sslm/canonical';
import type { LdFlagSummary } from '@sslm/ld-client';
import type { SourceRecord } from '@sslm/store';
import { Badge, Callout, Card, cx, Input } from '../components/ui.tsx';
import { loadLdFlags, useLdSession } from '../lib/ld.ts';

/**
 * Raw, read-only side-by-side list of gates (M1 shell; the full explorer with status strips,
 * fidelity and the detail drawer is M2). Left: StatSig, filtered and resolved for the selected
 * environment. Right: the LD flag with the same key, if LD is connected.
 */
export function GatesSideBySide({ workspaceId, sources, snapshots, env }: { workspaceId: string; sources: SourceRecord[]; snapshots: Record<string, CanonicalSnapshot | undefined>; env: string }) {
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState<string>();
  const ld = useLdSession(workspaceId);
  const snaps = sources.map((s) => snapshots[s.id]!).filter(Boolean);
  const matched = useMemo(() => matchAcrossSources(snaps, 'gate'), [snaps]);
  const aliasOf = (sourceId: string) => sources.find((s) => s.id === sourceId)?.alias ?? sourceId;

  // LD env mapping is M3; for now match by key.
  const ldEnv = ld.matrix?.environments.find((e) => e.key === env || e.name.toLowerCase() === env.toLowerCase());
  useEffect(() => {
    if (ld.status === 'connected' && ld.projectKey && ldEnv && ld.flags?.envKey !== ldEnv.key) void loadLdFlags(workspaceId, ldEnv.key);
  }, [ld.status, ld.projectKey, ldEnv?.key, workspaceId, ld.flags?.envKey]);
  const ldFlags = useMemo(() => new Map((ld.flags?.items ?? []).map((f) => [f.key, f])), [ld.flags]);

  const rows = matched
    .flatMap((m) => Object.entries(m.bySource).map(([sourceId, e]) => ({ sourceId, gate: e as Gate, shared: Object.keys(m.bySource).length })))
    .filter((r) => (showArchived || !r.gate.archived) && (!q || r.gate.id.toLowerCase().includes(q.toLowerCase())));

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold">Gates</h2>
        <Badge>{rows.length}</Badge>
        <span className="text-sm text-slate-500">
          in <b>{env}</b>
        </span>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> archived
          </label>
          <Input placeholder="Filter by name" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" aria-label="Filter gates" />
        </div>
      </div>
      {ld.status !== 'connected' && <div className="mb-3"><Callout tone="blue">Connect LaunchDarkly to fill in the right-hand column.</Callout></div>}
      {ld.status === 'connected' && ld.projectKey && !ldEnv && ld.matrix && (
        <div className="mb-3"><Callout>LD project “{ld.projectKey}” has no environment matching “{env}”. Environment mapping arrives in M3.</Callout></div>
      )}
      <Card className="overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="w-[46%] px-3 py-2">StatSig</th>
              <th className="w-[12%] px-3 py-2">In {env}</th>
              <th className="px-3 py-2">LaunchDarkly{ldEnv ? ` · ${ldEnv.key}` : ''}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ sourceId, gate, shared }) => {
              const key = `${sourceId}/${gate.id}`;
              const res = resolveRulesForEnvironment(gate.rules, env);
              const overrides = overridesForEnvironment(gate.overrides, env);
              const flag = ldFlags.get(gate.id);
              return (
                <Fragment key={key}>
                  <tr className={cx('cursor-pointer align-top hover:bg-slate-50', open === key && 'bg-slate-50')} onClick={() => setOpen(open === key ? undefined : key)}>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[13px] font-medium">{gate.id}</span>
                        {sources.length > 1 && <Badge tone="slate">{aliasOf(sourceId)}</Badge>}
                        {shared > 1 && <Badge tone="violet" title="Same name in more than one source (consolidation, M8)">in {shared} sources</Badge>}
                        {!gate.enabled && <Badge tone="red">disabled</Badge>}
                        {gate.archived && <Badge tone="slate">archived</Badge>}
                        {gate.lifecycle?.type === 'STALE' && <Badge tone="amber" title={gate.lifecycle.typeReason}>stale</Badge>}
                        {gate.idType !== 'userID' && <Badge tone="blue">{gate.idType}</Badge>}
                      </div>
                      {gate.description && <div className="mt-0.5 truncate text-xs text-slate-500">{gate.description}</div>}
                      <div className="mt-0.5 text-xs text-slate-400">
                        {gate.owner?.email ?? 'no owner'}
                        {gate.tags.length > 0 && ` · ${gate.tags.join(', ')}`}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      <div>{res.rules.length} rule{res.rules.length === 1 ? '' : 's'}</div>
                      {res.dropped.length > 0 && <div className="text-slate-400">{res.dropped.length} not here</div>}
                      {overrides.length > 0 && <div>{overrides.reduce((n, o) => n + o.ids.length, 0)} overrides</div>}
                    </td>
                    <td className="px-3 py-2">
                      <LdCell flag={flag} envKey={ldEnv?.key} connected={ld.status === 'connected' && !!ld.flags} />
                    </td>
                  </tr>
                  {open === key && (
                    <tr className="bg-slate-50">
                      <td colSpan={3} className="px-3 pb-3">
                        <div className="grid grid-cols-2 gap-3">
                          <Raw title={`StatSig · rules applying in ${env}`} value={{ enabled: gate.enabled, idType: gate.idType, rules: res.rules.map(({ conditions, ...r }) => ({ ...r, conditions: conditions.map(({ raw: _raw, ...c }) => c) })), overrides, dropped: res.dropped, unresolvedTierConditions: res.unresolved.length }} />
                          <Raw title={flag ? `LaunchDarkly · ${flag.key}` : 'LaunchDarkly'} value={flag ?? (ld.flags ? 'No flag with this key.' : 'Not connected.')} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function LdCell({ flag, envKey, connected }: { flag?: LdFlagSummary; envKey?: string; connected: boolean }) {
  if (!connected) return <span className="text-xs text-slate-400">—</span>;
  if (!flag) return <span className="text-xs text-slate-500">not in LD</span>;
  const on = envKey ? flag.environments?.[envKey]?.on : undefined;
  const ours = flag.tags?.includes('statsig-migrated');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[13px]">{flag.key}</span>
      {on !== undefined && <Badge tone={on ? 'green' : 'slate'}>{on ? 'on' : 'off'}</Badge>}
      {ours ? <Badge tone="blue">statsig-migrated</Badge> : <Badge tone="amber" title="Not created by this app: migrating needs a key_collision decision (M3)">existing key</Badge>}
    </div>
  );
}

function Raw({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-semibold text-slate-500">{title}</div>
      <pre className="max-h-96 overflow-auto rounded-md border border-slate-200 bg-white p-2 font-mono text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
