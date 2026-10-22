import { useEffect, useRef, useState } from 'react';
import type { CrawlProgress } from '@sslm/adapters';
import type { TransportEvent } from '@sslm/http';
import { cx } from './ui.tsx';

/**
 * Live activity for a Console API sync: a note that a full crawl takes a while, plus a log of the
 * requests going out, so a stall is visible as "no activity for Ns" rather than a frozen spinner.
 * Entries carry only method, path, status and timing: never headers or bodies (CLAUDE.md).
 */
export interface SyncLogEntry {
  at: number;
  text: string;
  tone: 'muted' | 'ok' | 'warn' | 'error';
  /** Set when the crawl is deliberately paused (rate budget) until about this time. */
  pausedUntil?: number;
}

export const SYNC_LOG_LIMIT = 300;

/** Appends an entry, keeping the log bounded. */
export function appendLog(log: SyncLogEntry[], entry: SyncLogEntry): SyncLogEntry[] {
  const next = log.length >= SYNC_LOG_LIMIT ? log.slice(log.length - SYNC_LOG_LIMIT + 1) : log.slice();
  next.push(entry);
  return next;
}

/** The request path relative to the Console API root, with its query string (ours carry no secrets). */
export function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/console\/v1/, '') + u.search;
  } catch {
    return url;
  }
}

export function describeTransportEvent(e: TransportEvent): SyncLogEntry {
  const at = Date.now();
  switch (e.type) {
    case 'request':
      return { at, tone: 'muted', text: `→ ${e.method} ${shortPath(e.url)}${e.attempt > 1 ? ` (attempt ${e.attempt})` : ''}` };
    case 'response':
      return { at, tone: e.status >= 200 && e.status < 300 ? 'ok' : 'warn', text: `← ${e.status} ${shortPath(e.url)} · ${Math.round(e.elapsedMs)} ms` };
    case 'retry':
      return { at, tone: 'warn', text: `retry ${shortPath(e.url)} in ${Math.round(e.delayMs / 100) / 10}s (${e.reason})` };
    case 'paced':
      return { at, tone: 'muted', pausedUntil: at + e.waitMs, text: `⏸ rate budget: next request in ${fmtSeconds(e.waitMs)} (${shortPath(e.url)})` };
    case 'throttled':
      return { at, tone: 'warn', text: `throttled · now at most ${e.newLimit} request${e.newLimit === 1 ? '' : 's'} in flight` };
    case 'gave-up':
      return { at, tone: 'error', text: `gave up on ${shortPath(e.url)} after ${e.attempts} attempts (${e.reason})` };
  }
}

function fmtSeconds(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s >= 90 ? `${Math.round(s / 60)} min` : `${s}s`;
}

export function describeProgress(p: CrawlProgress): SyncLogEntry {
  return { at: Date.now(), tone: 'ok', text: `✓ ${p.done}/${p.total} ${p.endpoint}` };
}

const STALL_AFTER_MS = 8_000;

export function SyncActivity({ log, running, className }: { log: SyncLogEntry[]; running: boolean; className?: string }) {
  const now = useNow(running);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const last = log[log.length - 1];
  const idleMs = running && last ? now - last.at : 0;
  // The most recent deliberate pause still in effect, if any: pacing is not a stall.
  const pause = running ? [...log].reverse().find((e) => e.pausedUntil !== undefined) : undefined;
  const pausedFor = pause && pause.pausedUntil! > now ? pause.pausedUntil! - now : 0;

  return (
    <div className={cx('rounded-md border border-line-soft bg-surface-2 p-2 text-xs', className)}>
      {running && (
        <p className="text-fg-muted">
          A full sync reads every gate, config, segment, experiment and metric in the project, one page at a time, within StatSig’s rate limit. On a large project
          this can take <b>several minutes</b>. You can keep using the console meanwhile.
        </p>
      )}
      {log.length > 0 && (
        <ol ref={listRef} aria-label="Sync request log" aria-live="polite" className={cx('max-h-36 overflow-y-auto font-mono text-[11px] leading-5', running && 'mt-1.5')}>
          {log.map((e, i) => (
            <li
              key={`${e.at}-${i}`}
              className={cx(
                'truncate',
                e.tone === 'muted' && 'text-fg-subtle',
                e.tone === 'ok' && 'text-fg-muted',
                e.tone === 'warn' && 'text-warning',
                e.tone === 'error' && 'text-error',
              )}
              title={e.text}
            >
              <span className="mr-2 text-fg-subtle tabular-nums">{time(e.at)}</span>
              {e.text}
            </li>
          ))}
        </ol>
      )}
      {running && pausedFor > 0 && (
        <p className="mt-1.5 text-fg-muted">
          Pacing to stay inside StatSig’s rate limit. Next request in {fmtSeconds(pausedFor)}.
        </p>
      )}
      {running && pausedFor <= 0 && idleMs > STALL_AFTER_MS && (
        <p className="mt-1.5 text-warning">
          No response for {Math.round(idleMs / 1000)}s. Waiting on StatSig or on the rate limiter; if this keeps climbing past a minute, the connection has stalled.
        </p>
      )}
    </div>
  );
}

function time(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** Ticks once a second while `active`, so "idle for Ns" counts up without new events. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
