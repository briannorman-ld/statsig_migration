/** Injectable time source so limiter/backoff logic is testable without real waits. */
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      const t = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

/**
 * A manually-advanced clock for tests. `sleep` resolves when `advance` moves time past its deadline.
 */
export class ManualClock implements Clock {
  private t: number;
  private sleepers: { until: number; resolve: () => void }[] = [];
  constructor(start = 0) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.sleepers.push({ until: this.t + Math.max(0, ms), resolve });
    });
  }
  /** Advance time, resolving sleepers in deadline order and yielding to the microtask queue between them. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      await flushMicrotasks();
      this.sleepers.sort((a, b) => a.until - b.until);
      const next = this.sleepers[0];
      if (!next || next.until > target) break;
      this.sleepers.shift();
      this.t = Math.max(this.t, next.until);
      next.resolve();
    }
    this.t = target;
    await flushMicrotasks();
  }
  /** Run until no sleepers remain (bounded). Returns elapsed virtual ms. */
  async runAll(maxMs = 24 * 3600_000): Promise<number> {
    const start = this.t;
    for (let i = 0; i < 100_000; i++) {
      await flushMicrotasks();
      this.sleepers.sort((a, b) => a.until - b.until);
      const next = this.sleepers[0];
      if (!next) break;
      if (next.until - start > maxMs) throw new Error('ManualClock.runAll exceeded maxMs');
      this.sleepers.shift();
      this.t = Math.max(this.t, next.until);
      next.resolve();
    }
    await flushMicrotasks();
    return this.t - start;
  }
  get pendingSleepers(): number {
    return this.sleepers.length;
  }
}

export async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
