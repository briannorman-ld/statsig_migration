import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { resetProject } from './reset.ts';

type Client = Parameters<typeof resetProject>[0];

/** An LD project with a few flags; `deleteFlag` records what it removed and can fire the cancel. */
function fakeProject(onDelete?: (key: string, n: number) => void) {
  const flags = new Set(['a', 'b', 'c', 'd']);
  const deleted: string[] = [];
  const client: Client = {
    listEnvironments: async () => [{ _id: '1', key: 'test', name: 'Test', color: 'fff', tags: [] } as never],
    listExperiments: async () => [],
    patchExperimentSemantic: async () => ({ key: 'x', name: 'x' }) as never,
    listFlags: async () => [...flags].map((key) => ({ key, name: key }) as never),
    deleteFlag: async (_p, key) => {
      flags.delete(key);
      deleted.push(key);
      onDelete?.(key, deleted.length);
    },
    listSegments: async () => [],
    deleteSegment: async () => undefined,
    listMetrics: async () => [],
    deleteMetric: async () => undefined,
    listContextKinds: async () => ({ items: [] }),
    putContextKind: async () => undefined,
    deleteEnvironment: async () => undefined,
  };
  return { client, flags, deleted };
}

describe('resetProject cancel', () => {
  it('stops after the request in flight and reports what was deleted so far', async () => {
    const ctrl = new AbortController();
    const { client, flags, deleted } = fakeProject((_key, n) => n === 2 && ctrl.abort(new DOMException('Cancelled by the user.', 'AbortError')));
    const phases: string[] = [];
    const report = await resetProject(client, 'p', (p) => phases.push(p.phase), ctrl.signal);
    expect(report.cancelled).toBe(true);
    expect(report.deleted.flags).toBe(2);
    expect(deleted).toEqual(['a', 'b']);
    expect(flags.size).toBe(2);
    expect(report.failures).toEqual([]);
    expect(phases.at(-1)).toBe('Cancelled');
    expect(phases).not.toContain('Deleting segments');
  });

  it('a signal aborted before the start deletes nothing', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { client, deleted } = fakeProject();
    const report = await resetProject(client, 'p', undefined, ctrl.signal);
    expect(report.cancelled).toBe(true);
    expect(deleted).toEqual([]);
  });

  it('without a signal, runs to the end as before', async () => {
    const { client, flags } = fakeProject();
    const report = await resetProject(client, 'p');
    expect(report.cancelled).toBeUndefined();
    expect(report.deleted.flags).toBe(4);
    expect(flags.size).toBe(0);
  });
});
