import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { emptySnapshot } from '@sslm/canonical';
import { assertNoSecrets, MigratorDb, SecretInStoreError, WorkspaceStore } from '../src/index.ts';

const store = () => new WorkspaceStore(new MigratorDb(`test-${crypto.randomUUID()}`));
let n = 0;
const source = (id: string) => ({ id, alias: id, label: `acme-${id}`, kind: 'console_api' as const, createdAt: `2026-01-01T00:00:0${n++}Z` });

describe('WorkspaceStore (Dexie / IndexedDB)', () => {
  it('stores a workspace with N sources and immutable snapshots', async () => {
    const s = store();
    const ws = await s.createWorkspace({ name: 'Acme Retail (Demo)', isDemo: true });
    await s.addSource(ws.id, source('web'));
    await s.addSource(ws.id, source('mobile'));
    expect((await s.listSources(ws.id)).map((x) => x.alias)).toEqual(['web', 'mobile']);

    const snap1 = emptySnapshot({ sourceId: 'web', sourceKind: 'console_api', alias: 'web' }, '2026-01-01T00:00:00Z');
    const snap2 = { ...snap1, takenAt: '2026-01-02T00:00:00Z' };
    await s.saveSnapshot(ws.id, snap1);
    const r2 = await s.saveSnapshot(ws.id, snap2);
    expect((await s.latestSnapshot('web'))?.id).toBe(r2.id);
    expect((await s.listSnapshots('web')).map((x) => x.takenAt)).toEqual(['2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z']);
    expect(await s.latestSnapshot('mobile')).toBeUndefined();
  });

  it('cascades deletes', async () => {
    const s = store();
    const ws = await s.createWorkspace({ name: 'x' });
    await s.addSource(ws.id, source('web'));
    await s.saveSnapshot(ws.id, emptySnapshot({ sourceId: 'web', sourceKind: 'console_api', alias: 'web' }, 't'));
    await s.saveCapabilities(ws.id, { capabilities: [] });
    await s.deleteWorkspace(ws.id);
    expect(await s.db.sources.count()).toBe(0);
    expect(await s.db.snapshots.count()).toBe(0);
    expect(await s.getCapabilities(ws.id)).toBeUndefined();
  });

  it('refuses to persist anything that looks like a token', async () => {
    const s = store();
    const ws = await s.createWorkspace({ name: 'x' });
    await expect(s.addSource(ws.id, { ...source('web'), apiKey: 'console-abc' } as never)).rejects.toBeInstanceOf(SecretInStoreError);
    await expect(s.updateWorkspace(ws.id, { ld: { instance: 'us', token: 'api-x' } as never })).rejects.toBeInstanceOf(SecretInStoreError);
    await expect(s.saveCapabilities(ws.id, { token: { tokenKind: 'auth' }, nested: { accessToken: 'x' } })).rejects.toBeInstanceOf(SecretInStoreError);
    expect(() => assertNoSecrets({ token: { tokenKind: 'auth' } })).toThrow(); // keys named token are refused, even when nested objects
    expect(() => assertNoSecrets({ tokenInfo: { tokenKind: 'auth' }, emptyToken: '' })).not.toThrow();
  });
});
