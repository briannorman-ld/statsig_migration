import { Fragment, useMemo, useState } from 'react';
import { matchAcrossSources, overridesForEnvironment, resolveRulesForEnvironment, type CanonicalSnapshot, type Gate } from '@sslm/canonical';
import { LD_INSTANCES } from '@sslm/ld-client';
import type { GateMapResult } from '@sslm/mapper';
import { migrationStatus, type MigrationStatus } from '@sslm/planner';
import type { SourceRecord } from '@sslm/store';
import { DecisionCard, FIDELITY_TONE } from '../components/DecisionCard.tsx';
import { LdTargeting, StatsigRules } from '../components/Targeting.tsx';
import { Badge, Button, Callout, Card, cx, Input, Select } from '../components/ui.tsx';
import { ldFlagState, mapGateFor } from '../lib/migration.ts';
import type { MigrationContext } from '../lib/useMigration.ts';

export const STATUS: Record<MigrationStatus, { label: string; tone: 'slate' | 'green' | 'amber' | 'red' | 'violet'; dot: string }> = {
  not_in_ld: { label: 'not migrated', tone: 'slate', dot: 'bg-neutral-fill' },
  not_migrated: { label: 'not migrated here', tone: 'slate', dot: 'bg-neutral-fill' },
  in_sync: { label: 'in sync', tone: 'green', dot: 'bg-success-fill' },
  statsig_changed: { label: 'StatSig changed', tone: 'amber', dot: 'bg-warning-fill' },
  decisions_changed: { label: 'decisions changed', tone: 'amber', dot: 'bg-warning-fill' },
  foreign: { label: 'existing LD key', tone: 'red', dot: 'bg-error-fill' },
  other_source: { label: 'migrated from another source', tone: 'violet', dot: 'bg-purple-fill' },
};

type StatusFilter = 'all' | 'open' | 'blocking' | 'not_migrated' | 'in_sync' | 'changed';

interface Row {
  sourceId: string;
  gate: Gate;
  shared: number;
  ldEnv: string | null;
  result: GateMapResult;
  /** Per LD environment, for the status strip. */
  strip: { ldEnv: string; status: MigrationStatus }[];
}

/**
 * Side-by-side gates (PLAN §9): StatSig on the left, LD on the right, with the per-environment
 * status strip read from LD provenance, fidelity and open decisions, and the Migrate action.
 */
export function GatesSideBySide({
  sources,
  snapshots,
  env,
  m,
  onMigrate,
  onOpenMapping,
}: {
  sources: SourceRecord[];
  snapshots: Record<string, CanonicalSnapshot | undefined>;
  env: string;
  m: MigrationContext;
  onMigrate: (gateUids: string[], ldEnvs: string[]) => void;
  onOpenMapping: () => void;
}) {
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [open, setOpen] = useState<string>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetEnvs, setTargetEnvs] = useState<string[] | null>(null);
  const { ld } = m;
  const snaps = sources.map((s) => snapshots[s.id]!).filter(Boolean);
  const matched = useMemo(() => matchAcrossSources(snaps, 'gate'), [snaps]);
  const aliasOf = (sourceId: string) => sources.find((s) => s.id === sourceId)?.alias ?? sourceId;
  const ldFlags = useMemo(() => new Map((ld.flags?.items ?? []).map((f) => [f.key, f])), [ld.flags]);
  const ldEnvOf = (sourceId: string, statsigEnv: string) => (m.connected ? (m.profile.sources[sourceId]?.envMapping[statsigEnv] ?? null) : null);

  const rows: Row[] = useMemo(
    () =>
      matched.flatMap((mr) =>
        Object.entries(mr.bySource).map(([sourceId, e]) => {
          const gate = e as Gate;
          const snap = snapshots[sourceId]!;
          const ldEnv = ldEnvOf(sourceId, env);
          const result = mapGateFor(snap, gate, { statsig: env, ld: ldEnv ?? env }, m);
          const strip = m.connected
            ? m.ldEnvs.map((le) => {
                const se = Object.entries(m.profile.sources[sourceId]?.envMapping ?? {}).find(([, v]) => v === le.key)?.[0];
                if (!se) return { ldEnv: le.key, status: 'not_in_ld' as MigrationStatus };
                const r = se === env ? result : mapGateFor(snap, gate, { statsig: se, ld: le.key }, m);
                const f = ldFlags.get(r.flagKey);
                return { ldEnv: le.key, status: migrationStatus(f && ldFlagState(f), le.key, r, { id: gate.id, source: snap.source.alias }).status };
              })
            : [];
          return { sourceId, gate, shared: Object.keys(mr.bySource).length, ldEnv, result, strip };
        }),
      ),
    [matched, snapshots, env, m, ldFlags],
  );

  const visible = rows.filter((r) => {
    if (!showArchived && r.gate.archived) return false;
    if (q && !r.gate.id.toLowerCase().includes(q.toLowerCase())) return false;
    const here = r.strip.find((s) => s.ldEnv === r.ldEnv)?.status;
    switch (filter) {
      case 'open':
        return r.result.unresolved.length > 0;
      case 'blocking':
        return r.result.unresolved.some((d) => d.severity === 'blocking');
      case 'not_migrated':
        return !here || here === 'not_in_ld' || here === 'not_migrated';
      case 'in_sync':
        return here === 'in_sync';
      case 'changed':
        return here === 'statsig_changed' || here === 'decisions_changed';
      default:
        return true;
    }
  });
  const selectable = visible.filter((r) => !r.gate.archived);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.gate.uid));
  const mappedHere = [...new Set(sources.map((s) => ldEnvOf(s.id, env)).filter((x): x is string => !!x))];
  const envChoice = targetEnvs ?? mappedHere;
  const unmappedSources = m.connected ? sources.filter((s) => !ldEnvOf(s.id, env)) : [];

  const toggle = (uid: string) =>
    setSelected((x) => {
      const n = new Set(x);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });

  return (
    <div className="pb-20">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl font-semibold tracking-tight">Gates</h2>
        <Badge>{visible.length}</Badge>
        <span className="text-sm text-fg-muted">
          StatSig <b>{env}</b>
          {mappedHere.length > 0 && (
            <>
              {' '}
              → LD <b>{mappedHere.join(', ')}</b>
            </>
          )}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as StatusFilter)} aria-label="Filter by status">
            <option value="all">All</option>
            <option value="open">Open decisions</option>
            <option value="blocking">Blocking decisions</option>
            <option value="not_migrated">Not migrated here</option>
            <option value="in_sync">In sync</option>
            <option value="changed">Changed since sync</option>
          </Select>
          <label className="flex items-center gap-1.5 text-sm text-fg-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> archived
          </label>
          <Input placeholder="Filter by name" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" aria-label="Filter gates" />
        </div>
      </div>
      {ld.status !== 'connected' && (
        <div className="mb-3">
          <Callout tone="blue">Connect LaunchDarkly to see what's already in LD and to migrate. Decisions can be made without it.</Callout>
        </div>
      )}
      {unmappedSources.length > 0 && (
        <div className="mb-3">
          <Callout>
            StatSig <b>{env}</b> isn't mapped to an LD environment for {unmappedSources.map((s) => s.label).join(', ')}, so it can't be migrated.{' '}
            <button className="font-medium underline" onClick={onOpenMapping}>
              Map environments
            </button>
          </Callout>
        </div>
      )}
      <Card className="overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-surface-2 text-left text-xs font-semibold tracking-wide text-fg-muted uppercase">
            <tr>
              <th className="w-9 px-3 py-2">
                <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.gate.uid)))} />
              </th>
              <th className="w-[38%] px-3 py-2">StatSig</th>
              <th className="w-[10%] px-3 py-2">In {env}</th>
              <th className="w-[18%] px-3 py-2">Mapping</th>
              <th className="px-3 py-2">LaunchDarkly</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {visible.map((row) => {
              const { sourceId, gate, shared, result: r } = row;
              const key = `${sourceId}/${gate.id}`;
              const res = resolveRulesForEnvironment(gate.rules, env);
              const overrides = overridesForEnvironment(gate.overrides, env);
              const flag = ldFlags.get(r.flagKey);
              const blocking = r.unresolved.filter((d) => d.severity === 'blocking').length;
              return (
                <Fragment key={key}>
                  <tr className={cx('cursor-pointer align-top hover:bg-surface-hover', open === key && 'bg-surface-2')} onClick={() => setOpen(open === key ? undefined : key)}>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${gate.id}`} disabled={gate.archived} checked={selected.has(gate.uid)} onChange={() => toggle(gate.uid)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[13px] font-medium">{gate.id}</span>
                        {sources.length > 1 && <Badge tone="slate">{aliasOf(sourceId)}</Badge>}
                        {shared > 1 && (
                          <Badge tone="violet" title="Same name in more than one source (consolidation, M8)">
                            in {shared} sources
                          </Badge>
                        )}
                        {!gate.enabled && <Badge tone="red">disabled</Badge>}
                        {gate.archived && <Badge tone="slate">archived</Badge>}
                        {gate.lifecycle?.type === 'STALE' && (
                          <Badge tone="amber" title={`${gate.lifecycle.typeReason}: consider hard-coding instead of migrating`}>
                            stale
                          </Badge>
                        )}
                        {gate.idType !== 'userID' && <Badge tone="blue">{gate.idType}</Badge>}
                      </div>
                      {gate.description && <div className="mt-0.5 truncate text-xs text-fg-muted">{gate.description}</div>}
                      <div className="mt-0.5 text-xs text-fg-subtle">
                        {gate.owner?.email ?? 'no owner'}
                        {gate.tags.length > 0 && ` · ${gate.tags.join(', ')}`}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-muted">
                      <div>
                        {res.rules.length} rule{res.rules.length === 1 ? '' : 's'}
                      </div>
                      {res.dropped.length > 0 && <div className="text-fg-subtle">{res.dropped.length} not here</div>}
                      {overrides.length > 0 && <div>{overrides.reduce((n, o) => n + o.ids.length, 0)} overrides</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {/* Fidelity is only meaningful once nothing is blocking. */}
                        {blocking === 0 && <Badge tone={FIDELITY_TONE[r.fidelity.overall]}>{r.skipped ? 'not migrated' : r.fidelity.overall}</Badge>}
                        {blocking > 0 && <Badge tone="red">{blocking} blocking</Badge>}
                        {r.unresolved.length - blocking > 0 && <Badge tone="amber">{r.unresolved.length - blocking} to decide</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <LdCell row={row} connected={ld.status === 'connected' && !!ld.flags} flagExists={!!flag} on={row.ldEnv ? (flag?.environments?.[row.ldEnv]?.on ?? undefined) : undefined} />
                    </td>
                  </tr>
                  {open === key && (
                    <tr className="bg-surface-2">
                      <td colSpan={5} className="px-3 pb-4">
                        <Detail row={row} m={m} env={env} res={res} overrides={overrides} flagUrl={flag && ld.projectKey && row.ldEnv ? `${LD_INSTANCES[ld.instance ?? 'us'].origin}/${ld.projectKey}/${row.ldEnv}/features/${flag.key}` : undefined} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>

      {selected.size > 0 && (
        <div className="fixed right-0 bottom-0 left-72 z-40 border-t border-line bg-surface/95 px-5 py-3 shadow-raised backdrop-blur">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm font-medium">
              {selected.size} gate{selected.size === 1 ? '' : 's'} selected
            </span>
            <button className="text-sm text-fg-muted hover:text-fg" onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-fg-muted">Migrate to LD:</span>
              {m.ldEnvs.map((e) => (
                <label key={e.key} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={envChoice.includes(e.key)} onChange={() => setTargetEnvs(envChoice.includes(e.key) ? envChoice.filter((x) => x !== e.key) : [...envChoice, e.key])} />
                  {e.key}
                  {e.critical && <Badge tone="red">critical</Badge>}
                </label>
              ))}
              {!m.connected && <span className="text-fg-subtle">connect LaunchDarkly first</span>}
            </div>
            <Button className="ml-auto" disabled={!m.connected || envChoice.length === 0} onClick={() => onMigrate([...selected], envChoice)}>
              Plan migration…
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LdCell({ row, connected, flagExists, on }: { row: Row; connected: boolean; flagExists: boolean; on?: boolean }) {
  if (!connected) return <span className="text-xs text-fg-subtle">—</span>;
  const here = row.strip.find((s) => s.ldEnv === row.ldEnv);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {flagExists ? <span className="font-mono text-[13px]">{row.result.flagKey}</span> : <span className="text-xs text-fg-muted">not in LD</span>}
        {on !== undefined && <Badge tone={on ? 'green' : 'slate'}>{on ? 'on' : 'off'}</Badge>}
        {here && here.status !== 'not_in_ld' && <Badge tone={STATUS[here.status].tone}>{STATUS[here.status].label}</Badge>}
      </div>
      <div className="flex gap-2.5 text-[11px] text-fg-muted">
        {row.strip.map((s) => (
          <span key={s.ldEnv} className="flex items-center gap-1" title={`${s.ldEnv}: ${STATUS[s.status].label}`}>
            <span className={cx('h-2 w-2 rounded-full', STATUS[s.status].dot)} />
            {s.ldEnv}
          </span>
        ))}
      </div>
    </div>
  );
}

function Detail({ row, m, env, res, overrides, flagUrl }: { row: Row; m: MigrationContext; env: string; res: ReturnType<typeof resolveRulesForEnvironment>; overrides: Gate['overrides']; flagUrl?: string }) {
  const r = row.result;
  const stale = new Map(r.stale.map((s) => [s.decision.id, s.previous]));
  return (
    <div className="space-y-3 pt-1">
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3">
          <div className="mb-2 text-xs font-semibold text-fg-muted">StatSig · rules applying in {env}</div>
          <StatsigRules rules={res.rules} overrides={overrides} enabled={row.gate.enabled} />
        </Card>
        <Card className="p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-fg-muted">
            <span>
              LaunchDarkly · {r.skipped ? 'not migrated' : row.ldEnv ? `proposed for ${row.ldEnv}` : m.connected ? 'proposed (environment not mapped)' : 'proposed'}
              {r.unresolved.length > 0 && !r.skipped && ' (preview with recommended answers)'}
            </span>
            {flagUrl && (
              <a href={flagUrl} target="_blank" rel="noreferrer" className="ml-auto font-normal text-link hover:underline">
                Open in LD ↗
              </a>
            )}
          </div>
          {r.skipped ? <p className="text-xs text-fg-muted">{r.skipped}</p> : <LdTargeting env={r.env} variations={r.shell.variations} />}
        </Card>
      </div>
      {r.fidelity.notes.length > 0 && (
        <Card className="p-3">
          <div className="mb-1.5 text-xs font-semibold text-fg-muted">Fidelity</div>
          <ul className="space-y-1 text-xs">
            {r.fidelity.notes.map((n, i) => (
              <li key={i} className="flex gap-2">
                <Badge tone={FIDELITY_TONE[n.fidelity]}>{n.fidelity}</Badge>
                <span>
                  {n.message}
                  {n.location && <span className="text-fg-subtle"> · {n.location}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {(r.unresolved.length > 0 || r.applied.length > 0) && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-fg-muted">Decisions</div>
          {r.unresolved.map((d) => (
            <DecisionCard key={d.id} decision={d} stale={stale.get(d.id)} compact onChoose={(o) => void m.resolve([d], o)} />
          ))}
          {r.applied.map((a) => (
            <DecisionCard key={a.decision.id} decision={a.decision} current={{ optionKey: a.optionKey, via: a.via }} compact onChoose={(o) => void m.resolve([a.decision], o)} />
          ))}
        </div>
      )}
    </div>
  );
}
