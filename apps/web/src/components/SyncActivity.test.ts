import { describe, expect, it } from 'vitest';
import { appendLog, describeTransportEvent, shortPath, SYNC_LOG_LIMIT } from './SyncActivity.tsx';

describe('sync activity log', () => {
  it('shortens Console API URLs to their path and keeps the query', () => {
    expect(shortPath('https://statsigapi.net/console/v1/gates?page=2&limit=100')).toBe('/gates?page=2&limit=100');
    expect(shortPath('not a url')).toBe('not a url');
  });

  it('describes transport events without headers or bodies', () => {
    const req = describeTransportEvent({ type: 'request', method: 'GET', url: 'https://statsigapi.net/console/v1/gates', attempt: 2 });
    expect(req.text).toBe('→ GET /gates (attempt 2)');
    const res = describeTransportEvent({ type: 'response', method: 'GET', url: 'https://statsigapi.net/console/v1/gates', status: 429, elapsedMs: 120.4 });
    expect(res).toMatchObject({ tone: 'warn', text: '← 429 /gates · 120 ms' });
    const gaveUp = describeTransportEvent({ type: 'gave-up', method: 'GET', url: 'https://statsigapi.net/console/v1/gates', attempts: 5, reason: 'timeout' });
    expect(gaveUp.tone).toBe('error');
  });

  it('keeps the log bounded', () => {
    let log = [] as ReturnType<typeof appendLog>;
    for (let i = 0; i < SYNC_LOG_LIMIT + 10; i++) log = appendLog(log, { at: i, text: String(i), tone: 'muted' });
    expect(log).toHaveLength(SYNC_LOG_LIMIT);
    expect(log[0]!.text).toBe('10');
  });
});

describe('rate-budget pauses', () => {
  it('marks a paced event as a deliberate pause rather than a stall', () => {
    const e = describeTransportEvent({ type: 'paced', url: 'https://statsigapi.net/console/v1/segments/s1/id_list?page=8', waitMs: 2400 });
    expect(e.tone).toBe('muted');
    expect(e.text).toContain('next request in 2s');
    expect(e.pausedUntil).toBeGreaterThan(e.at);
  });
});
