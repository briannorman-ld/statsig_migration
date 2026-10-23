import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LdLockup, LdMark } from '../components/Brand.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';
import { Badge, Button, Callout, Card, cx, Input, Label, Select, Spinner } from '../components/ui.tsx';

/**
 * The "migrate LaunchDarkly → StatSig" wizard. It is a joke for internal eyes, gated behind
 * localStorage `ldtoss=true` (lib/ldtoss.ts): fourteen steps of deliberately tedious retention
 * theatre that end with a phone number instead of a migration.
 *
 * Nothing here touches a workspace, IndexedDB, LaunchDarkly or StatSig. The security-question
 * step asks for absurd personal details on purpose; those inputs are uncontrolled, only "has
 * something been typed" is tracked, and the fields are cleared the moment the step is left.
 * No answer from any step is persisted, logged or sent anywhere.
 */

export const CONCIERGE_NUMBER = '605-477-3018';
const CONFIRM_PHRASE = 'I would like to migrate to StatSig.';

const STEPS = [
  'Welcome',
  'Eligibility',
  'Reason for leaving',
  'Terms of Departure',
  'Identity verification',
  'Inventory',
  'Plan selection',
  'Reverse decisions',
  'Humanity check',
  'Cutover window',
  'Exit survey',
  'Queue',
  'Final confirmation',
  'Concierge',
] as const;

export function ReverseMigrationScreen({ onExit }: { onExit: () => void }) {
  const [step, setStep] = useState(0);
  // Each step keeps its own state; remounting on index change resets it, which is the point.
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  // The total shown grows as you go. It is always wrong until the end.
  const shownTotal = step >= STEPS.length - 2 ? STEPS.length : Math.min(STEPS.length - 1, step + 4);
  const last = step === STEPS.length - 1;

  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 pt-6">
        <button type="button" onClick={onExit} title="Back to the console" className="rounded-md p-1 transition-colors hover:bg-surface-hover">
          <LdLockup className="h-7 w-auto text-logo" />
        </button>
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-10 pb-16">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold tracking-[0.14em] text-fg-muted uppercase">LaunchDarkly → StatSig</p>
            <Badge tone="violet">beta</Badge>
          </div>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.03em] text-fg">Reverse migration</h1>
          <div className="mt-4 flex items-center gap-3 text-xs text-fg-muted">
            <span className="tabular-nums">
              Step {step + 1} of {last ? shownTotal : `~${shownTotal}`}
            </span>
            <span aria-hidden>·</span>
            <span>{STEPS[step]}</span>
            {!last && <span className="ml-auto">Estimated time remaining: {Math.max(1, 14 - step + Math.floor(step / 2))} min</span>}
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full bg-gradient-brand transition-[width] duration-500" style={{ width: `${((step + 1) / shownTotal) * 100}%` }} />
          </div>
        </div>

        <Card className="relative overflow-hidden p-6">
          <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-brand" />
          {step === 0 && <Welcome onNext={next} />}
          {step === 1 && <Eligibility onNext={next} />}
          {step === 2 && <Reason onNext={next} />}
          {step === 3 && <Terms onNext={next} />}
          {step === 4 && <Identity onNext={next} />}
          {step === 5 && <Inventory onNext={next} />}
          {step === 6 && <Plan onNext={next} />}
          {step === 7 && <Decisions onNext={next} />}
          {step === 8 && <Humanity onNext={next} />}
          {step === 9 && <Cutover onNext={next} />}
          {step === 10 && <Survey onNext={next} />}
          {step === 11 && <Queue onNext={next} />}
          {step === 12 && <Confirm onNext={next} />}
          {step === 13 && <Concierge onExit={onExit} />}
        </Card>

        {!last && (
          <div className="mt-4 flex items-center justify-between text-xs text-fg-subtle">
            <button type="button" onClick={back} disabled={step === 0} className="rounded px-1 hover:text-fg disabled:opacity-40">
              ← Back {step > 0 && <span className="text-fg-subtle">(this step starts over)</span>}
            </button>
            <button type="button" onClick={onExit} className="rounded px-1 hover:text-fg">
              Never mind, I’ll stay with LaunchDarkly
            </button>
          </div>
        )}
      </main>

      <footer className="border-t border-line-soft">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-6 py-4 text-xs text-fg-subtle">
          <LdMark className="h-3.5 w-3.5 text-logo" />A LaunchDarkly tool · Reverse migrations are handled with care, and at length.
        </div>
      </footer>
    </div>
  );
}

/* ───────────────────────────── helpers ───────────────────────────── */

type StepProps = { onNext: () => void };

/** Reveals one more of `count` items every `everyMs`, starting after `delayMs`. */
function useStaged(count: number, everyMs: number, delayMs = 400, paused = false): number {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (paused || shown >= count) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? delayMs : everyMs);
    return () => clearTimeout(t);
  }, [shown, count, everyMs, delayMs, paused]);
  return shown;
}

function StepTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="font-display text-xl font-semibold tracking-tight text-fg">{children}</h2>
      {hint && <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{hint}</p>}
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-wrap items-center gap-3">{children}</div>;
}

function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex items-start gap-2.5 text-sm', disabled ? 'text-fg-subtle' : 'text-fg')}>
      <input type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function Radio({ name, value, current, onChange, children }: { name: string; value: string; current: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-fg">
      <input type="radio" className="mt-0.5" name={name} value={value} checked={current === value} onChange={() => onChange(value)} />
      <span>{children}</span>
    </label>
  );
}

function ProgressBar({ pct, tone = 'accent' }: { pct: number; tone?: 'accent' | 'error' }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full transition-[width] duration-300', tone === 'error' ? 'bg-error-fill' : 'bg-accent')} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ───────────────────────────── 1. Welcome ───────────────────────────── */

function Welcome({ onNext }: StepProps) {
  return (
    <>
      <StepTitle hint="This guided wizard moves a LaunchDarkly project to StatSig. It is one-way, fully assisted, and should take about four minutes.">
        Leaving so soon?
      </StepTitle>
      <ul className="space-y-2 text-sm text-fg-muted">
        <li className="flex gap-2">
          <span className="text-success">✓</span> Flags become gates. Context kinds become a user object. Segments become a conversation.
        </li>
        <li className="flex gap-2">
          <span className="text-success">✓</span> Every imperfect mapping becomes a Decision. Every Decision becomes a feeling.
        </li>
        <li className="flex gap-2">
          <span className="text-success">✓</span> Nothing is moved mid-flight. Everything is moved mid-afternoon.
        </li>
      </ul>
      <Callout tone="blue">
        Before you begin, please have ready: your workspace name, a government-issued ID, and a quiet place to make a phone call.
      </Callout>
      <Actions>
        <Button onClick={onNext}>Begin reverse migration</Button>
      </Actions>
    </>
  );
}

/* ───────────────────────────── 2. Eligibility ───────────────────────────── */

const CHECKS: { label: string; result: string; tone: 'green' | 'amber' }[] = [
  { label: 'Checking your account standing', result: 'good standing', tone: 'green' },
  { label: 'Checking your flags for unresolved feelings', result: 'none found', tone: 'green' },
  { label: 'Checking whether StatSig is still accepting migrations', result: 'as of today', tone: 'green' },
  { label: 'Checking whether your SDK keys have been told', result: 'they have not', tone: 'amber' },
  { label: 'Checking whether you really mean this', result: 'inconclusive', tone: 'amber' },
];

function Eligibility({ onNext }: StepProps) {
  const shown = useStaged(CHECKS.length + 1, 1400);
  const done = shown > CHECKS.length;
  return (
    <>
      <StepTitle hint="A few quick checks before we let you go. Please do not close this tab; it will not stop us, but it will slow us down.">Eligibility check</StepTitle>
      <ul className="space-y-2.5 text-sm">
        {CHECKS.map((c, i) => (
          <li key={c.label} className={cx('flex items-center gap-3', i >= shown && 'opacity-40')}>
            {i < shown - 1 || (i === shown - 1 && done) ? (
              <Badge tone={c.tone}>{c.result}</Badge>
            ) : i === shown - 1 ? (
              <span className="text-fg-muted">
                <Spinner />
              </span>
            ) : (
              <span className="inline-block h-3.5 w-3.5 rounded-full border border-line" aria-hidden />
            )}
            <span className="text-fg">{c.label}…</span>
          </li>
        ))}
      </ul>
      {done && <Callout tone="amber">You are eligible to migrate. Unfortunately.</Callout>}
      <Actions>
        <Button onClick={onNext} disabled={!done}>
          {done ? 'Continue anyway' : 'Checking…'}
        </Button>
      </Actions>
    </>
  );
}

/* ───────────────────────────── 3. Reason ───────────────────────────── */

const REASONS = ['Pricing', 'Missing a feature', 'My manager told me to', 'I lost a bet', 'I want to find out what happens at the end of this wizard', 'Other'];
const MIN_WORDS = 60;

function Reason({ onNext }: StepProps) {
  const [reason, setReason] = useState('');
  const [more, setMore] = useState('');
  const [sure, setSure] = useState<'unasked' | 'asking' | 'yes'>('unasked');
  const left = Math.max(0, MIN_WORDS - more.trim().length);
  const ready = reason !== '' && left === 0;
  return (
    <>
      <StepTitle hint="Help us understand. Then help us understand more.">Why are you leaving LaunchDarkly?</StepTitle>
      <div className="space-y-2">
        {REASONS.map((r) => (
          <Radio key={r} name="reason" value={r} current={reason} onChange={(v) => { setReason(v); setSure('unasked'); }}>
            {r}
          </Radio>
        ))}
      </div>
      <div className="mt-5">
        <Label htmlFor="rm-more">Tell us more (required, at least {MIN_WORDS} characters)</Label>
        <textarea
          id="rm-more"
          rows={4}
          value={more}
          onChange={(e) => { setMore(e.target.value); setSure('unasked'); }}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg shadow-card placeholder:text-fg-subtle focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25"
          placeholder={reason === 'Pricing' ? 'Have you heard that StatSig bills per event? Start there.' : 'Be specific. Be kind. Be at least sixty characters.'}
        />
        <p className={cx('mt-1 text-xs tabular-nums', left ? 'text-fg-subtle' : 'text-success')}>{left ? `${left} more character${left === 1 ? '' : 's'}` : 'That will do.'}</p>
      </div>
      {sure === 'asking' && (
        <div className="mt-4">
          <Callout tone="amber">
            <div className="flex flex-wrap items-center gap-3">
              <span>
                Is <i>“{reason}”</i> really the reason, though?
              </span>
              <span className="ml-auto flex gap-2">
                <Button variant="secondary" className="py-1 text-xs" onClick={() => setSure('yes')}>
                  Yes
                </Button>
                <Button variant="secondary" className="py-1 text-xs" onClick={() => { setReason(''); setMore(''); setSure('unasked'); }}>
                  No, let me pick again
                </Button>
              </span>
            </div>
          </Callout>
        </div>
      )}
      <Actions>
        {sure === 'yes' ? (
          <Button onClick={onNext}>Continue</Button>
        ) : (
          <Button onClick={() => setSure('asking')} disabled={!ready || sure === 'asking'}>
            Continue
          </Button>
        )}
      </Actions>
    </>
  );
}

/* ───────────────────────────── 4. Terms ───────────────────────────── */

const TERMS: [string, string][] = [
  ['1. Definitions', '“You” means you. “Us” means the people you are leaving. “StatSig” means the other place. “Flag” means the thing you are about to start calling a “gate”, and we are sorry about that in advance.'],
  ['2. Scope', 'These Terms of Departure govern the reverse migration of one (1) LaunchDarkly project, in whole, with feeling, to a destination that will refer to your environments as “tiers”.'],
  ['3. Flags and gates', 'Flags with more than two variations will be migrated as a boolean plus a note. The note will be lost in transit. You will be asked about this later, in a step called Reverse decisions, and the options will not be good.'],
  ['4. Contexts', 'Multi-context evaluation will be flattened into a single user object. Your “organization” context will become a custom field named organization_id, which is a string. It was always a string, emotionally.'],
  ['5. Segments', 'Rule-based segments will be migrated as a list of the users who matched them at 14:02 on the day of cutover. Big segments will be migrated as a medium segment and a feeling of unease.'],
  ['6. Experiments', 'Running experiments are not moved. They end here, with dignity, and start again over there, at zero. Nothing is moved mid-flight. This is the one part of these terms that is also true of the forward direction, and we stand by it.'],
  ['7. Acknowledgements', '(a) The Departing Party acknowledges that approvals, scheduled changes and the audit log exist, and that they were nice. (b) The Departing Party acknowledges that they will miss dark mode. (c) The Departing Party acknowledges that 7(b) is about them specifically.'],
  ['8. Pricing', 'StatSig bills per event. An “event” is anything that happens. You agree that things will continue to happen.'],
  ['9. Support', 'Support for the reverse migration is provided by telephone. There is no chat. There is no email. There is a number, and it is at the end of this wizard, and you will have earned it.'],
  ['10. Severability', 'If any part of these terms is found unenforceable, the remaining parts will quietly judge it.'],
  ['11. Governing law', 'These terms are governed by the laws of whichever region your SDK key starts with.'],
  ['12. Termination', 'You may terminate this agreement at any time by closing the tab. We would prefer that, honestly. The “Never mind” link is right there.'],
  ['13. Entire agreement', 'These terms constitute the entire agreement between you and us, except for the parts we both know about and are not writing down.'],
];

function Terms({ onNext }: StepProps) {
  const [scrolled, setScrolled] = useState(false);
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  const [c, setC] = useState(false);
  return (
    <>
      <StepTitle hint="Scroll to the end to enable the first checkbox. The other two are on the honor system, which is why there are two of them.">Terms of Departure</StepTitle>
      <div
        className="max-h-60 space-y-3 overflow-y-auto rounded-md border border-line bg-surface-2 p-4 text-sm leading-relaxed text-fg-muted"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) setScrolled(true);
        }}
      >
        {TERMS.map(([h, body]) => (
          <section key={h}>
            <h3 className="font-semibold text-fg">{h}</h3>
            <p>{body}</p>
          </section>
        ))}
        <p className="pt-2 text-xs text-fg-subtle">— end of terms —</p>
      </div>
      <div className="mt-4 space-y-2.5">
        <Check checked={a} onChange={setA} disabled={!scrolled}>
          I have read the Terms of Departure{!scrolled && <span className="text-fg-subtle"> (keep scrolling)</span>}
        </Check>
        <Check checked={b} onChange={setB} disabled={!a}>
          I have actually read them, not just scrolled
        </Check>
        <Check checked={c} onChange={setC} disabled={!b}>
          I acknowledge that section 7(b) is about me
        </Check>
      </div>
      <Actions>
        <Button onClick={onNext} disabled={!(a && b && c)}>
          Accept and continue
        </Button>
      </Actions>
    </>
  );
}

/* ───────────────────────────── 5. Identity ───────────────────────────── */

/*
 * The questions are absurd on purpose. The inputs below are uncontrolled and type="password":
 * React never holds their values, only whether something has been typed, and the form is reset
 * before the step unmounts. Nothing typed here is kept, logged or sent anywhere.
 */
const QUESTIONS = [
  'Your Social Security number',
  'The full name of your first newborn',
  'The make and model of your first car',
  'The street you grew up on, and whether you were happy there',
  'The key of the first feature flag you ever created',
  'The PIN of the debit card you use the least',
] as const;

function Identity({ onNext }: StepProps) {
  const form = useRef<HTMLFormElement>(null);
  const [answered, setAnswered] = useState<boolean[]>(() => QUESTIONS.map(() => false));
  const [phase, setPhase] = useState<'form' | 'verifying' | 'done'>('form');
  const all = answered.every(Boolean);
  useEffect(() => {
    if (phase !== 'verifying') return;
    form.current?.reset(); // the answers are gone before anything else happens
    const t = setTimeout(() => setPhase('done'), 2600);
    return () => clearTimeout(t);
  }, [phase]);
  // Belt and braces: whatever happens to this step, the fields do not outlive it.
  useEffect(() => () => form.current?.reset(), []);
  return (
    <>
      <StepTitle hint="For your security, please answer the following. For our security, we will not be keeping the answers.">Verify your identity</StepTitle>
      <form
        ref={form}
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          if (all && phase === 'form') setPhase('verifying');
        }}
        className="space-y-4"
      >
        {QUESTIONS.map((q, i) => (
          <div key={q}>
            <Label htmlFor={`idq-${i}`}>
              {q} {answered[i] && <span className="ml-1 normal-case tracking-normal text-success">✓ answered</span>}
            </Label>
            <Input
              id={`idq-${i}`}
              name={`q${i}`}
              type="password"
              autoComplete="off"
              disabled={phase !== 'form'}
              placeholder="••••••••"
              onChange={(e) => {
                const has = e.target.value.length > 0;
                setAnswered((arr) => (arr[i] === has ? arr : arr.map((v, j) => (j === i ? has : v))));
              }}
            />
          </div>
        ))}
        <p className="text-xs text-fg-subtle">
          Answers are not saved, read, compared with anything, or looked at. We just wanted to see whether you would type them.
        </p>
        {phase === 'verifying' && (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Spinner /> Verifying…
          </div>
        )}
        {phase === 'done' && <Callout tone="amber">We could not verify any of that. Continuing.</Callout>}
        <Actions>
          {phase === 'done' ? (
            <Button onClick={onNext}>Continue</Button>
          ) : (
            <Button type="submit" disabled={!all || phase !== 'form'}>
              {phase === 'verifying' ? 'Verifying…' : 'Verify'}
            </Button>
          )}
        </Actions>
      </form>
    </>
  );
}

/* ───────────────────────────── 6. Inventory ───────────────────────────── */

const INVENTORY_FIRST = [
  'Counting flags… 1,284',
  'Packing flags into gates…',
  'Flattening 6 context kinds into user_id…',
  'Looking for somewhere to put your segments…',
  'Translating semVerLessThan into version_gte and negating…',
  'Un-negating…',
  'Re-negating…',
  'Exporting audit log… (StatSig is going to ask what this is)',
  'Exporting approvals…',
];
const INVENTORY_RETRY = ['Retrying with lower expectations…', 'Skipping approvals…', 'Skipping the audit log…', 'Skipping the part where this made sense…', 'Done.'];

function Inventory({ onNext }: StepProps) {
  const [attempt, setAttempt] = useState(0);
  const lines = attempt === 0 ? INVENTORY_FIRST : INVENTORY_RETRY;
  const shown = useStaged(lines.length, attempt === 0 ? 900 : 650);
  const failed = attempt === 0 && shown >= lines.length;
  const done = attempt > 0 && shown >= lines.length;
  const pct = attempt === 0 ? Math.min(83, (shown / lines.length) * 100) : 83 + (shown / lines.length) * 17;
  return (
    <>
      <StepTitle hint="Taking inventory of what you are about to give up. This may take a moment; it is a lot.">Inventory</StepTitle>
      <ProgressBar pct={pct} tone={failed ? 'error' : 'accent'} />
      <ul className="mt-4 space-y-1.5 font-mono text-xs text-fg-muted">
        {lines.slice(0, shown).map((l, i) => (
          <li key={`${attempt}-${i}`} className={i === shown - 1 && !failed && !done ? 'text-fg' : ''}>
            {l}
          </li>
        ))}
        {!failed && !done && (
          <li className="flex items-center gap-2 text-fg">
            <Spinner />
          </li>
        )}
      </ul>
      {failed && (
        <div className="mt-4">
          <Callout tone="red">
            Export failed at 83%: <code className="text-[13px]">E_PACKET_TOO_EMOTIONAL</code>. This is usually transient. So is everything.
          </Callout>
        </div>
      )}
      <Actions>
        {failed && (
          <Button variant="secondary" onClick={() => setAttempt(1)}>
            Retry
          </Button>
        )}
        <Button onClick={onNext} disabled={!done}>
          Continue
        </Button>
      </Actions>
    </>
  );
}

/* ───────────────────────────── 7. Plan ───────────────────────────── */

const fmtMoney = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`);
const fmtEvents = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(0)}M` : `${Math.round(n).toLocaleString()}`);

function Plan({ onNext }: StepProps) {
  const [exp, setExp] = useState(60); // 10^(exp/10) events: 1M .. 100B
  const [plan, setPlan] = useState('');
  const [cadence, setCadence] = useState('');
  const [sales, setSales] = useState(false);
  const events = Math.pow(10, exp / 10);
  const bill = events * 0.00009 + 2_500;
  const ready = plan !== '' && cadence !== '' && (plan !== 'enterprise' || sales);
  return (
    <>
      <StepTitle hint="StatSig bills per event. Estimate how many events you produce in a month, and we will estimate how you will feel about it.">Choose a plan</StepTitle>
      <Label htmlFor="rm-events">Monthly evaluations</Label>
      <input id="rm-events" type="range" min={60} max={110} value={exp} onChange={(e) => setExp(Number(e.target.value))} className="w-full accent-[var(--app-accent)]" />
      <div className="flex items-baseline justify-between text-sm">
        <span className="tabular-nums text-fg">{fmtEvents(events)} events / month</span>
        <span className="tabular-nums text-fg-muted">
          Estimated bill: <b className="text-fg">{fmtMoney(bill)}</b> / month, give or take a decimal place
        </span>
      </div>
      <div className="mt-5 space-y-2">
        <Radio name="plan" value="free" current={plan} onChange={setPlan}>
          <b>Free</b> — up to one (1) evaluation per month. Make it count.
        </Radio>
        <Radio name="plan" value="pro" current={plan} onChange={setPlan}>
          <b>Pro</b> — billed per event, per environment, per feeling. Includes a dashboard about the bill.
        </Radio>
        <Radio name="plan" value="enterprise" current={plan} onChange={setPlan}>
          <b>Enterprise</b> — contact sales. Sales will contact you. Repeatedly.
        </Radio>
      </div>
      {plan === 'enterprise' && (
        <div className="mt-3">
          <Check checked={sales} onChange={setSales}>
            I consent to being contacted by sales at the number I will be calling later in this wizard
          </Check>
        </div>
      )}
      <div className="mt-5 max-w-xs">
        <Label htmlFor="rm-cadence">Billing cadence</Label>
        <Select id="rm-cadence" value={cadence} onChange={(e) => setCadence(e.target.value)} className="w-full">
          <option value="">Choose…</option>
          <option value="monthly">Monthly</option>
          <option value="annually">Annually (save 0%)</option>
          <option value="whenever">Whenever an event happens</option>
        </Select>
      </div>
      <Actions>
        <Button onClick={onNext} disabled={!ready}>
          Continue
        </Button>
      </Actions>
    </>
  );
}

/* ───────────────────────────── 8. Decisions ───────────────────────────── */

const DECISIONS: { finding: string; options: string[] }[] = [
  { finding: 'Segment “beta-users” is rule-based and has an excluded list.', options: ['Drop the exclusions', 'Drop the rules', 'Drop the segment'] },
  { finding: 'Flag “checkout-v2” has four variations. Gates are boolean.', options: ['Keep true and false; the other two were probably fine', 'Make four gates and a spreadsheet', 'Make it a Dynamic Config and never speak of it'] },
  { finding: 'Context kind “organization” is targeted in 38 rules.', options: ['Rename it to “user” and hope', 'Add organization_id as a custom field on every user', 'Ask each organization to sign up as a person'] },
  { finding: 'A rule uses semVerLessThan 2.4.0.', options: ['version_gte 2.4.0, negated', 'version_gte 2.4.0, negated, then negated again to be safe', 'Remove the rule; everyone updates eventually'] },
  { finding: 'Operator “in” matches case-sensitively here. StatSig’s “any” does not.', options: ['Accept matching ADMIN, Admin and aDmIn', 'Lowercase every user on Earth', 'Add a Decision about this Decision'] },
  { finding: 'Production requires two approvers for flag changes.', options: ['Replace with a Slack message', 'Replace with vibes', 'Replace with nothing (recommended by nobody)'] },
  { finding: 'Experiment “pricing-page-copy” is running (day 12 of 14).', options: ['End it now and call it inconclusive', 'Wait two days, then open this wizard again from the start', 'Restart it in StatSig with zero participants'] },
];

function Decisions({ onNext }: StepProps) {
  const [i, setI] = useState(0);
  const [saving, setSaving] = useState(false);
  const [why, setWhy] = useState(false);
  const d = DECISIONS[i];
  const done = i >= DECISIONS.length;
  const choose = () => {
    setSaving(true);
    setWhy(false);
    setTimeout(() => {
      setSaving(false);
      setI((n) => n + 1);
    }, 1300);
  };
  return (
    <>
      <StepTitle hint="Every imperfect mapping becomes a Decision. In this direction, they are all imperfect, and the decision is mostly about which part to lose.">
        Reverse decisions
      </StepTitle>
      <div className="mb-3 flex items-center gap-2 text-xs text-fg-muted tabular-nums">
        <span>
          {Math.min(i, DECISIONS.length)} of {DECISIONS.length} resolved
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${(Math.min(i, DECISIONS.length) / DECISIONS.length) * 100}%` }} />
        </div>
      </div>
      {d && !done && (
        <div className="rounded-md border border-warning-line/50 bg-warning-bg p-4">
          <div className="flex items-center gap-2">
            <Badge tone="amber">blocking</Badge>
            <span className="text-sm font-medium text-fg">{d.finding}</span>
          </div>
          <div className="mt-3 flex flex-col items-start gap-2">
            {d.options.map((o) => (
              <Button key={o} variant="secondary" className="justify-start text-left" onClick={choose} disabled={saving}>
                {o}
              </Button>
            ))}
          </div>
          <div className="mt-3 text-xs text-fg-muted">
            {saving ? (
              <span className="flex items-center gap-2">
                <Spinner /> Recording decision…
              </span>
            ) : (
              <button type="button" className="text-link hover:underline" onClick={() => setWhy((w) => !w)}>
                Why can’t I keep it as it is?
              </button>
            )}
            {why && !saving && <p className="mt-1 text-fg">Because.</p>}
          </div>
        </div>
      )}
      {done && <Callout tone="green">All seven decisions recorded. None of them were good, but they were yours.</Callout>}
      <Actions>
        <Button onClick={onNext} disabled={!done}>
          Continue
        </Button>
      </Actions>
    </>
  );
}

/* ───────────────────────────── 9. Humanity ───────────────────────────── */

const TILES = ['🚩', '🏁', '🎌', '🏳️', '🏴', '🎏', '🪧', '🏳️‍🌈', '📍'];

function shuffle<T>(a: readonly T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function Humanity({ onNext }: StepProps) {
  const [tiles, setTiles] = useState(() => shuffle(TILES));
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [attempt, setAttempt] = useState(0);
  const passed = attempt >= 2;
  const verify = () => {
    setAttempt((n) => n + 1);
    setPicked(new Set());
    setTiles(shuffle(TILES));
  };
  return (
    <>
      <StepTitle hint="Select all tiles containing a feature flag. There is a correct answer. We are not going to tell you what it is.">Confirm you are human</StepTitle>
      <div className="grid max-w-xs grid-cols-3 gap-2" role="group" aria-label="Tiles">
        {tiles.map((t, i) => (
          <button
            key={`${attempt}-${i}`}
            type="button"
            aria-pressed={picked.has(i)}
            disabled={passed}
            onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
            className={cx('flex aspect-square items-center justify-center rounded-md border text-3xl transition-colors', picked.has(i) ? 'border-selected-line bg-selected' : 'border-line bg-surface-2 hover:bg-surface-hover')}
          >
            {t}
          </button>
        ))}
      </div>
      {attempt === 1 && (
        <div className="mt-4">
          <Callout tone="red">Incorrect. Please try again.</Callout>
        </div>
      )}
      {passed && (
        <div className="mt-4">
          <Callout tone="green">Still incorrect, but you are clearly human. Only a human would keep trying.</Callout>
        </div>
      )}
      <Actions>
        {passed ? (
          <Button onClick={onNext}>Continue</Button>
        ) : (
          <Button onClick={verify} disabled={picked.size === 0}>
            Verify
          </Button>
        )}
      </Actions>
    </>
  );
}

/* ───────────────────────────── 10. Cutover ───────────────────────────── */

const ZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Kolkata', 'Pacific/Auckland', 'Pacific/Chatham', 'Whatever your laptop says', 'StatSig’s'];
const REFUSALS = ['That window is unavailable. Everyone picked that one.', 'That window is unavailable. Nobody is around then, and we checked.'];

function Cutover({ onNext }: StepProps) {
  const [when, setWhen] = useState('');
  const [zone, setZone] = useState('');
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const accepted = tries >= REFUSALS.length + 1;
  const request = () => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setTries((n) => n + 1);
      if (tries < REFUSALS.length) setWhen('');
    }, 1200);
  };
  return (
    <>
      <StepTitle hint="Pick a time for the cutover. We will check whether it is available. It will not be, at first.">Schedule the cutover window</StepTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="rm-when">Date and time</Label>
          <Input id="rm-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={busy || accepted} />
        </div>
        <div>
          <Label htmlFor="rm-zone">Time zone</Label>
          <Select id="rm-zone" value={zone} onChange={(e) => setZone(e.target.value)} className="w-full" disabled={busy || accepted}>
            <option value="">Choose…</option>
            {ZONES.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </Select>
        </div>
      </div>
      {!accepted && tries > 0 && (
        <div className="mt-4">
          <Callout tone="amber">{REFUSALS[tries - 1]} Please choose another.</Callout>
        </div>
      )}
      {accepted && (
        <div className="mt-4">
          <Callout tone="green">Fine. Scheduled for {when ? new Date(when).toLocaleString() : 'the time you chose'} ({zone || 'UTC'}). Someone will probably be around.</Callout>
        </div>
      )}
      <Actions>
        {accepted ? (
          <Button onClick={onNext}>Continue</Button>
        ) : (
          <Button onClick={request} disabled={busy || when === '' || zone === ''}>
            {busy && <Spinner />} {busy ? 'Checking availability…' : 'Request this window'}
          </Button>
        )}
      </Actions>
    </>
  );
}

/* ───────────────────────────── 11. Survey ───────────────────────────── */

function Survey({ onNext }: StepProps) {
  const [score, setScore] = useState<number>();
  const [reconsidered, setReconsidered] = useState(0);
  const [better, setBetter] = useState('');
  const [stance, setStance] = useState<'open' | 'firm'>('open');
  const low = score !== undefined && score < 9;
  const ready = score !== undefined && better.trim().length > 0 && (!low || stance === 'firm');
  return (
    <>
      <StepTitle hint="One last thing before the queue. Two, actually.">Exit survey</StepTitle>
      <p className="text-sm text-fg">How likely are you to recommend LaunchDarkly to a colleague?</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Score">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={score === n}
            onClick={() => { setScore(n); setStance('open'); }}
            className={cx('h-9 w-9 rounded-md border text-sm tabular-nums transition-colors', score === n ? 'border-selected-line bg-selected font-medium text-selected-fg' : 'border-line bg-surface hover:bg-surface-hover')}
          >
            {n}
          </button>
        ))}
      </div>
      {low && stance === 'open' && (
        <div className="mt-4">
          <Callout tone="amber">
            <div className="flex flex-wrap items-center gap-3">
              <span>{reconsidered === 0 ? 'Noted. That is hurtful. Would you like to reconsider?' : 'Still hurtful. Last chance to reconsider.'}</span>
              <span className="ml-auto flex gap-2">
                <Button variant="secondary" className="py-1 text-xs" onClick={() => { setScore(undefined); setReconsidered((n) => n + 1); }}>
                  Reconsider
                </Button>
                <Button variant="secondary" className="py-1 text-xs" onClick={() => setStance('firm')}>
                  No
                </Button>
              </span>
            </div>
          </Callout>
        </div>
      )}
      {score !== undefined && !low && (
        <div className="mt-4">
          <Callout tone="blue">A {score}. Then why are you here?</Callout>
        </div>
      )}
      <div className="mt-5">
        <Label htmlFor="rm-better">What could we have done better? (required)</Label>
        <Input id="rm-better" value={better} onChange={(e) => setBetter(e.target.value)} placeholder="Be honest. We can take it. We will discuss it in a meeting you are not in." />
      </div>
      <Actions>
        <Button onClick={onNext} disabled={!ready}>
          Submit and join the queue
        </Button>
      </Actions>
    </>
  );
}

/* ───────────────────────────── 12. Queue ───────────────────────────── */

function Queue({ onNext }: StepProps) {
  const [pos, setPos] = useState(4_218);
  const [bumped, setBumped] = useState(false);
  const [note, setNote] = useState<string>();
  useEffect(() => {
    if (pos <= 1) {
      const t = setTimeout(onNext, 1500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setPos((p) => {
        if (!bumped && p < 900) {
          setBumped(true);
          setNote('A higher-priority customer joined the queue.');
          return 1_340;
        }
        return Math.max(1, p - (25 + Math.floor(Math.random() * 55)));
      });
    }, 70);
    return () => clearTimeout(t);
  }, [pos, bumped, onNext]);
  return (
    <>
      <StepTitle hint="Connecting you to the StatSig migration service. Your call is important to us; your place in line is less so.">Please hold</StepTitle>
      <div className="rounded-md border border-line bg-surface-2 p-6 text-center">
        <div className="text-xs font-semibold tracking-wide text-fg-muted uppercase">You are number</div>
        <div className="mt-1 font-display text-5xl font-bold tabular-nums tracking-tight text-fg">{pos.toLocaleString()}</div>
        <div className="mt-1 text-xs text-fg-muted">in the queue · estimated wait: {pos <= 1 ? '0 minutes' : `${Math.ceil(pos / 40)} minutes`}</div>
        <div className="mt-4 text-xs text-fg-subtle">♪ hold music is not available in this browser ♪</div>
      </div>
      {note && (
        <div className="mt-4">
          <Callout tone="amber">{note}</Callout>
        </div>
      )}
      {pos <= 1 && (
        <div className="mt-4 flex items-center gap-2 text-sm text-fg-muted">
          <Spinner /> Connecting…
        </div>
      )}
    </>
  );
}

/* ───────────────────────────── 13. Confirm ───────────────────────────── */

function Confirm({ onNext }: StepProps) {
  const [typed, setTyped] = useState('');
  const exact = typed === CONFIRM_PHRASE;
  const hint =
    typed === ''
      ? undefined
      : exact
        ? undefined
        : typed.trim().toLowerCase() === CONFIRM_PHRASE.toLowerCase()
          ? 'Case matters to us.'
          : typed.trim().toLowerCase().replace(/\.$/, '') === CONFIRM_PHRASE.toLowerCase().replace(/\.$/, '')
            ? 'Close. Punctuation matters to us.'
            : typed.length >= CONFIRM_PHRASE.length
              ? 'That is not the phrase.'
              : undefined;
  return (
    <>
      <StepTitle hint="Type the phrase below exactly. Capital letters, spaces and the full stop are all part of the phrase, and all part of the process.">Final confirmation</StepTitle>
      <p className="rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-fg select-all">{CONFIRM_PHRASE}</p>
      <Input className="mt-3 font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Confirmation phrase" placeholder="Type it here" autoFocus onKeyDown={(e) => e.key === 'Enter' && exact && onNext()} />
      <p className={cx('mt-1.5 min-h-4 text-xs', exact ? 'text-success' : 'text-fg-muted')}>{exact ? 'Matches.' : hint}</p>
      <Actions>
        <Button onClick={onNext} disabled={!exact}>
          Complete migration
        </Button>
      </Actions>
    </>
  );
}

/* ───────────────────────────── 14. Concierge ───────────────────────────── */

function Concierge({ onExit }: { onExit: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Badge tone="green">step 14 of 14</Badge>
        <span className="text-xs text-fg-muted">Really.</span>
      </div>
      <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-fg">One last step.</h2>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
        Reverse migrations are completed over the phone by our Migration Concierge. Call the number below and have your workspace name ready. Lines are open 24 hours a day,
        7 days a week, except when they are not.
      </p>
      <a
        href={`tel:${CONCIERGE_NUMBER.replace(/\D/g, '')}`}
        className="mt-6 flex items-center justify-center gap-3 rounded-lg border border-line bg-surface-2 px-6 py-5 font-display text-3xl font-bold tracking-tight text-fg shadow-card transition-colors hover:bg-surface-hover"
      >
        <span aria-hidden>☎</span> {CONCIERGE_NUMBER}
      </a>
      <p className="mt-3 text-center text-xs text-fg-subtle">Please mention reference code LD-STAY. The concierge will know what to do.</p>
      <Actions>
        <Button variant="secondary" onClick={onExit}>
          Actually, I’ll stay with LaunchDarkly
        </Button>
      </Actions>
      <p className="mt-6 border-t border-line-soft pt-4 text-xs text-fg-subtle">
        No LaunchDarkly or StatSig data was read, changed or sent anywhere during this flow, and nothing you typed into it was kept.
      </p>
    </>
  );
}
