import type { Clock } from './clock.ts';

export interface AimdOptions {
  /** Concurrency to start at. PLAN §5.1: about 3 in flight. */
  initial: number;
  min: number;
  max: number;
  /** Consecutive successes needed before concurrency grows by one (additive increase). */
  successesPerIncrease: number;
}

export const DEFAULT_AIMD: AimdOptions = { initial: 3, min: 1, max: 6, successesPerIncrease: 10 };

/**
 * AIMD concurrency limiter (PLAN §5.1). Neither StatSig nor LD expose rate-limit headers to
 * browser JS (§3.1), so the only signal is "that request was throttled". On a throttle the
 * window halves; successes slowly grow it back.
 */
export class AimdLimiter {
  private limitValue: number;
  private inFlight = 0;
  private successStreak = 0;
  private waiters: (() => void)[] = [];
  readonly opts: AimdOptions;

  constructor(opts: Partial<AimdOptions> = {}) {
    this.opts = { ...DEFAULT_AIMD, ...opts };
    this.limitValue = clamp(this.opts.initial, this.opts.min, this.opts.max);
  }

  get limit(): number {
    return this.limitValue;
  }
  get active(): number {
    return this.inFlight;
  }

  async acquire(): Promise<() => void> {
    while (this.inFlight >= Math.floor(this.limitValue)) {
      await new Promise<void>((r) => this.waiters.push(r));
    }
    this.inFlight++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight--;
      this.wake();
    };
  }

  onSuccess(): void {
    this.successStreak++;
    if (this.successStreak >= this.opts.successesPerIncrease) {
      this.successStreak = 0;
      const before = Math.floor(this.limitValue);
      this.limitValue = Math.min(this.opts.max, this.limitValue + 1);
      if (Math.floor(this.limitValue) > before) this.wake();
    }
  }

  onThrottle(): void {
    this.successStreak = 0;
    this.limitValue = Math.max(this.opts.min, Math.floor(this.limitValue / 2));
  }

  /** Wake one waiter per freed slot; it re-checks the limit in its acquire loop. */
  private wake(): void {
    if (this.inFlight < Math.floor(this.limitValue)) this.waiters.shift()?.();
  }
}

export interface RateWindow {
  limit: number;
  windowMs: number;
}

/**
 * Sliding-window request budget, e.g. StatSig's ~900 req / 15 min per project (PLAN §4.1).
 * `take()` resolves when a request may start without exceeding any window.
 */
export class RateBudget {
  private stamps: number[] = [];
  private queue: Promise<void> = Promise.resolve();
  constructor(
    readonly windows: RateWindow[],
    private readonly clock: Clock,
  ) {}

  /** Requests counted in the largest window so far. */
  get used(): number {
    this.prune(this.clock.now());
    return this.stamps.length;
  }

  /** How long the next request would wait right now, in ms (0 when a slot is free). */
  peekWait(): number {
    const now = this.clock.now();
    this.prune(now);
    return this.waitNeeded(now);
  }

  take(signal?: AbortSignal): Promise<void> {
    // Serialize so concurrent callers don't all observe the same free slot.
    const next = this.queue.then(() => this.takeOne(signal));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async takeOne(signal?: AbortSignal): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      this.prune(now);
      const wait = this.waitNeeded(now);
      if (wait <= 0) {
        this.stamps.push(now);
        return;
      }
      await this.clock.sleep(wait, signal);
    }
  }

  private waitNeeded(now: number): number {
    let wait = 0;
    for (const w of this.windows) {
      const inWindow = this.stamps.filter((s) => s > now - w.windowMs);
      if (inWindow.length >= w.limit) {
        const oldest = inWindow[inWindow.length - w.limit];
        if (oldest !== undefined) wait = Math.max(wait, oldest + w.windowMs - now + 1);
      }
    }
    return wait;
  }

  private prune(now: number): void {
    const maxWindow = Math.max(0, ...this.windows.map((w) => w.windowMs));
    this.stamps = this.stamps.filter((s) => s > now - maxWindow);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
