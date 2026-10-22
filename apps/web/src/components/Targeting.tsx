import type { Condition, Override, Rule } from '@sslm/canonical';
import type { DesiredFlagEnv, LdClause, VariationOrRollout } from '@sslm/mapper';
import { Badge } from './ui.tsx';

/** StatSig rules after environment filtering, in plain language (left side of the rules diff, PLAN §9). */
export function StatsigRules({ rules, overrides, enabled }: { rules: Rule[]; overrides: Override[]; enabled: boolean }) {
  return (
    <div className="space-y-1.5 text-xs">
      {!enabled && <Badge tone="red">gate disabled: everyone fails</Badge>}
      {overrides.map((o, i) => (
        <Line key={`o${i}`} label="override">
          {o.ids.length} {o.unitType} ID{o.ids.length === 1 ? '' : 's'} → <b>{o.value.kind === 'gate' ? (o.value.pass ? 'pass' : 'fail') : o.value.groupName}</b>
          {o.environment && <span className="text-fg-subtle"> ({o.environment} only)</span>}
        </Line>
      ))}
      {rules.map((r) => (
        <Line key={r.id} label={r.name}>
          {r.conditions.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="text-fg-subtle"> and </span>}
              <Cond c={c} />
            </span>
          ))}
          <span className="text-fg-subtle"> → </span>
          <b>{r.passPercentage === 100 ? 'pass' : r.passPercentage === 0 ? 'fail' : `${r.passPercentage}% pass`}</b>
        </Line>
      ))}
      <Line label="otherwise">
        <b>fail</b>
      </Line>
    </div>
  );
}

function Cond({ c }: { c: Condition }) {
  if (c.type === 'public') return <span>everyone</span>;
  const what = c.type === 'custom_field' ? c.field : c.type === 'unit_id' ? `${c.customID}` : c.type;
  const value = Array.isArray(c.targetValue) ? c.targetValue.map(String).join(', ') : c.targetValue === undefined || c.targetValue === null ? '' : String(c.targetValue);
  return (
    <span>
      <code className="text-fg">{what}</code> {c.operator ? <span className="text-purple">{String(c.operator)}</span> : null} {value && <span className="text-fg-muted">{trim(value)}</span>}
    </span>
  );
}

/** Generated LD configuration for one environment (right side of the rules diff). */
export function LdTargeting({ env, variations }: { env: DesiredFlagEnv; variations: { value: unknown; name: string }[] }) {
  const v = (i: number | undefined) => String(variations[i ?? 0]?.value);
  const serve = (s: VariationOrRollout) =>
    s.rollout ? (
      <b>
        {s.rollout.variations.map((w) => `${w.weight / 1000}% ${v(w.variation)}`).join(' / ')} <span className="font-normal text-fg-subtle">by {s.rollout.contextKind}</span>
      </b>
    ) : (
      <b>{v(s.variation)}</b>
    );
  return (
    <div className="space-y-1.5 text-xs">
      <Line label="targeting">
        <Badge tone={env.on ? 'green' : 'slate'}>{env.on ? 'on' : 'off'}</Badge> <span className="text-fg-subtle">off serves</span> <b>{v(env.offVariation)}</b>
      </Line>
      {env.prerequisites.map((p) => (
        <Line key={p.key} label="prerequisite">
          <code>{p.key}</code> is <b>{String(p.variation === 0)}</b>
        </Line>
      ))}
      {env.targets.map((t, i) => (
        <Line key={`t${i}`} label="targets">
          {t.values.length} {t.contextKind} key{t.values.length === 1 ? '' : 's'} → <b>{v(t.variation)}</b>
        </Line>
      ))}
      {env.rules.map((r, i) => (
        <Line key={i} label={r.description}>
          {r.clauses.map((c, j) => (
            <span key={j}>
              {j > 0 && <span className="text-fg-subtle"> and </span>}
              <Clause c={c} />
            </span>
          ))}
          <span className="text-fg-subtle"> → </span>
          {serve(r)}
        </Line>
      ))}
      <Line label="default rule">{serve(env.fallthrough)}</Line>
    </div>
  );
}

function Clause({ c }: { c: LdClause }) {
  if (c.op === 'segmentMatch')
    return (
      <span>
        {c.negate ? 'not ' : ''}in segment <code>{c.values.join(', ')}</code>
      </span>
    );
  return (
    <span>
      <code className="text-fg">
        {c.contextKind}.{c.attribute}
      </code>{' '}
      <span className="text-link">
        {c.negate ? 'not ' : ''}
        {c.op}
      </span>{' '}
      <span className="text-fg-muted">{trim(c.values.map(String).join(', '))}</span>
    </span>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-28 shrink-0 truncate text-fg-subtle" title={label}>
        {label}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function trim(s: string): string {
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}
