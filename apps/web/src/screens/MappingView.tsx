import { useState } from 'react';
import type { CanonicalSnapshot } from '@sslm/canonical';
import { defaultKindFor, type MappingProfile } from '@sslm/mapper';
import type { SourceRecord } from '@sslm/store';
import { Badge, Callout, Card, Input, Select } from '../components/ui.tsx';
import type { MigrationContext } from '../lib/useMigration.ts';

/**
 * Mapping profile (PLAN §7, §12): per source, which LD environment each StatSig environment
 * migrates to, and which LD context kind each unit type becomes.
 */
export function MappingView({ sources, snapshots, m, onConnect }: { sources: SourceRecord[]; snapshots: Record<string, CanonicalSnapshot | undefined>; m: MigrationContext; onConnect: () => void }) {
  const save = (fn: (p: MappingProfile) => void) => {
    const next: MappingProfile = structuredClone(m.profile);
    fn(next);
    void m.saveProfile(next);
  };
  return (
    <div className="max-w-4xl space-y-5">
      <h2 className="text-lg font-semibold">Mapping</h2>
      {!m.connected && (
        <Callout tone="blue">
          <button className="font-medium underline" onClick={onConnect}>
            Connect LaunchDarkly
          </button>{' '}
          to map StatSig environments to the LD project's environments.
        </Callout>
      )}
      {sources.map((s) => {
        const snap = snapshots[s.id];
        if (!snap) return null;
        const sp = m.profile.sources[s.id] ?? { envMapping: {}, unitTypeKinds: {} };
        const used = Object.values(sp.envMapping).filter(Boolean) as string[];
        const dup = used.filter((v, i) => used.indexOf(v) !== i);
        return (
          <Card key={s.id} className="p-5">
            <h3 className="mb-3 font-semibold">
              {s.label} <Badge>{s.alias}</Badge>
            </h3>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Environments</div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {snap.environments.map((e) => (
                      <tr key={e.name}>
                        <td className="py-1.5 pr-3">
                          <span className="font-mono">{e.name}</span>
                          {e.isProduction && (
                            <Badge tone="red" title="StatSig production tier">
                              prod
                            </Badge>
                          )}
                          {e.inferred && <Badge tone="amber">inferred</Badge>}
                        </td>
                        <td className="py-1.5 text-slate-400">→</td>
                        <td className="py-1.5">
                          <Select
                            aria-label={`LD environment for ${e.name}`}
                            disabled={!m.connected}
                            value={sp.envMapping[e.name] ?? ''}
                            onChange={(ev) => save((p) => void ((p.sources[s.id] ??= { envMapping: {}, unitTypeKinds: {} }).envMapping[e.name] = ev.target.value || null))}
                          >
                            <option value="">not migrated</option>
                            {m.ldEnvs.map((l) => (
                              <option key={l.key} value={l.key}>
                                {l.key}
                              </option>
                            ))}
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {dup.length > 0 && (
                  <div className="mt-2">
                    <Callout tone="red">Two StatSig environments map to LD “{dup[0]}”. Within one source, map at most one environment to each LD environment.</Callout>
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-500">Environments marked “not migrated” keep LD's default (off, serving false) and keep calling StatSig.</p>
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Unit types → context kinds</div>
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {snap.unitTypes.map((u) => (
                      <UnitTypeRow
                        key={u.name}
                        unitType={u.name}
                        value={sp.unitTypeKinds[u.name]}
                        existing={m.capabilities.existingContextKinds}
                        onChange={(kind) =>
                          save((p) => {
                            const t = (p.sources[s.id] ??= { envMapping: {}, unitTypeKinds: {} }).unitTypeKinds;
                            if (kind) t[u.name] = kind;
                            else delete t[u.name];
                          })
                        }
                      />
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-slate-500">Custom unit IDs get their own context kind; they are never folded into “user”. Kinds that don't exist in LD are created during the migration.</p>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function UnitTypeRow({ unitType, value, existing, onChange }: { unitType: string; value?: string; existing: string[]; onChange: (kind: string | null) => void }) {
  const proposed = defaultKindFor(unitType);
  const [draft, setDraft] = useState(value ?? '');
  return (
    <tr>
      <td className="py-1.5 pr-3 font-mono">{unitType}</td>
      <td className="py-1.5 text-slate-400">→</td>
      <td className="py-1.5">
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Context kind for ${unitType}`}
            className="w-36 py-1 font-mono"
            placeholder={proposed}
            value={draft}
            list="ld-context-kinds"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onChange(draft.trim() || null)}
          />
          <datalist id="ld-context-kinds">
            {existing.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          {!value && <span className="text-xs text-slate-400">default “{proposed}”{proposed !== 'user' && !existing.includes(proposed) ? ' (asks first)' : ''}</span>}
          {value && !existing.includes(value) && <Badge tone="blue">will be created</Badge>}
        </div>
      </td>
    </tr>
  );
}
