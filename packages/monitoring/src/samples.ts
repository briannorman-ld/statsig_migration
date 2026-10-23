import type { MonitorSample } from './types.ts';

/** Without a change, one sample per item at most this often: enough to prove a 7-day quiet period. */
export const SAMPLE_MIN_INTERVAL_MS = 6 * 3600 * 1000;
/** Samples older than this are pruned; the cut-over rule only looks back 7 days. */
export const SAMPLE_RETENTION_MS = 90 * 24 * 3600 * 1000;

/**
 * Keep a new reading only when it says something new (LD traffic status changed, or StatSig checks
 * crossed zero) or the last one is old. Keeps IndexedDB from filling up at one row per flag per check.
 */
export function shouldSample(prev: MonitorSample | undefined, next: Omit<MonitorSample, 'at'>, now: string, minIntervalMs = SAMPLE_MIN_INTERVAL_MS): boolean {
  if (!prev) return true;
  if (prev.ldStatus !== next.ldStatus) return true;
  if ((prev.statsigChecksPerHour === 0) !== (next.statsigChecksPerHour === 0)) return true;
  if ((prev.statsigChecksPerHour == null) !== (next.statsigChecksPerHour == null)) return true;
  return Date.parse(now) - Date.parse(prev.at) >= minIntervalMs;
}

/** The newest sample per `<flagKey>|<ldEnv>`. */
export function latestSamples(samples: readonly MonitorSample[]): Map<string, MonitorSample> {
  const out = new Map<string, MonitorSample>();
  for (const s of samples) {
    const k = `${s.flagKey}|${s.ldEnv}`;
    const cur = out.get(k);
    if (!cur || cur.at < s.at) out.set(k, s);
  }
  return out;
}

export function pruneSamples<T extends MonitorSample>(samples: readonly T[], now: string, retentionMs = SAMPLE_RETENTION_MS): T[] {
  const cutoff = Date.parse(now) - retentionMs;
  return samples.filter((s) => Date.parse(s.at) >= cutoff);
}
