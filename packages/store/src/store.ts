import type { CanonicalSnapshot, SourceDescriptor } from '@sslm/canonical';
import { MigratorDb, type CapabilityRecord, type SnapshotRecord, type SourceRecord, type SpecUploadRecord, type WorkspaceRecord } from './db.ts';

/** Property names that must never be persisted (CLAUDE.md: tokens never persisted unencrypted). */
const SECRET_KEYS = /^(token|apiKey|api_key|statsigApiKey|consoleKey|clientKey|ldToken|accessToken|authorization|secret|password|sdkKey|mobileKey)$/i;

export class SecretInStoreError extends Error {
  constructor(path: string) {
    super(`Refusing to persist a secret-looking field at ${path}. Tokens stay in memory.`);
    this.name = 'SecretInStoreError';
  }
}

/** Throws if any object key anywhere in `value` looks like a credential. */
export function assertNoSecrets(value: unknown, path = '$', depth = 0): void {
  if (depth > 12 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    // Snapshots can hold large arrays (ID lists); only objects can carry secret keys.
    for (let i = 0; i < value.length; i++) if (value[i] && typeof value[i] === 'object') assertNoSecrets(value[i], `${path}[${i}]`, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.test(k) && v !== undefined && v !== null && v !== '') throw new SecretInStoreError(`${path}.${k}`);
    assertNoSecrets(v, `${path}.${k}`, depth + 1);
  }
}

const now = () => new Date().toISOString();

export class WorkspaceStore {
  constructor(readonly db: MigratorDb = new MigratorDb()) {}

  async createWorkspace(input: { id?: string; name: string; isDemo?: boolean; ld?: WorkspaceRecord['ld'] }): Promise<WorkspaceRecord> {
    const ws: WorkspaceRecord = { id: input.id ?? crypto.randomUUID(), name: input.name, isDemo: input.isDemo ?? false, createdAt: now(), updatedAt: now(), ...(input.ld ? { ld: input.ld } : {}) };
    assertNoSecrets(ws);
    await this.db.workspaces.put(ws);
    return ws;
  }

  listWorkspaces(): Promise<WorkspaceRecord[]> {
    return this.db.workspaces.orderBy('updatedAt').reverse().toArray();
  }

  getWorkspace(id: string): Promise<WorkspaceRecord | undefined> {
    return this.db.workspaces.get(id);
  }

  async updateWorkspace(id: string, patch: Partial<Omit<WorkspaceRecord, 'id' | 'createdAt'>>): Promise<void> {
    assertNoSecrets(patch);
    await this.db.workspaces.update(id, { ...patch, updatedAt: now() });
  }

  /** Deletes the workspace and everything under it. */
  async deleteWorkspace(id: string): Promise<void> {
    await this.db.transaction('rw', [this.db.workspaces, this.db.sources, this.db.snapshots, this.db.specUploads, this.db.capabilities], async () => {
      await this.db.sources.where('workspaceId').equals(id).delete();
      await this.db.snapshots.where('workspaceId').equals(id).delete();
      await this.db.specUploads.where('workspaceId').equals(id).delete();
      await this.db.capabilities.delete(id);
      await this.db.workspaces.delete(id);
    });
  }

  async addSource(workspaceId: string, source: SourceDescriptor): Promise<SourceRecord> {
    const rec: SourceRecord = { ...source, workspaceId };
    assertNoSecrets(rec);
    await this.db.sources.put(rec);
    await this.touch(workspaceId);
    return rec;
  }

  listSources(workspaceId: string): Promise<SourceRecord[]> {
    return this.db.sources.where('workspaceId').equals(workspaceId).sortBy('createdAt');
  }

  async removeSource(sourceId: string): Promise<void> {
    await this.db.transaction('rw', [this.db.sources, this.db.snapshots, this.db.specUploads], async () => {
      await this.db.snapshots.where('sourceId').equals(sourceId).delete();
      await this.db.specUploads.where('sourceId').equals(sourceId).delete();
      await this.db.sources.delete(sourceId);
    });
  }

  /** Snapshots are immutable: each save is a new record. */
  async saveSnapshot(workspaceId: string, snapshot: CanonicalSnapshot): Promise<SnapshotRecord> {
    // No assertNoSecrets here: snapshots hold customer config values, which may legitimately
    // have keys like "token". Our credentials can only reach the records we shape ourselves.
    const rec: SnapshotRecord = {
      id: crypto.randomUUID(),
      workspaceId,
      sourceId: snapshot.source.sourceId,
      takenAt: snapshot.takenAt,
      sourceKind: snapshot.source.sourceKind,
      summary: { gates: snapshot.gates.length, configs: snapshot.configs.length, segments: snapshot.segments.length, experiments: snapshot.experiments.length, warnings: snapshot.warnings.length },
      canonical: snapshot,
    };
    await this.db.snapshots.add(rec);
    await this.touch(workspaceId);
    return rec;
  }

  async latestSnapshot(sourceId: string): Promise<SnapshotRecord | undefined> {
    return this.db.snapshots.where('[sourceId+takenAt]').between([sourceId, ''], [sourceId, '￿']).last();
  }

  /** Newest first, without the canonical payload. */
  async listSnapshots(sourceId: string): Promise<Omit<SnapshotRecord, 'canonical'>[]> {
    const all = await this.db.snapshots.where('[sourceId+takenAt]').between([sourceId, ''], [sourceId, '￿']).reverse().toArray();
    return all.map(({ canonical: _c, ...rest }) => rest);
  }

  async saveSpecUpload(rec: Omit<SpecUploadRecord, 'id' | 'uploadedAt'>): Promise<SpecUploadRecord> {
    const full: SpecUploadRecord = { ...rec, id: crypto.randomUUID(), uploadedAt: now() };
    await this.db.specUploads.add(full);
    return full;
  }

  listSpecUploads(sourceId: string): Promise<SpecUploadRecord[]> {
    return this.db.specUploads.where('[sourceId+uploadedAt]').between([sourceId, ''], [sourceId, '￿']).reverse().toArray();
  }

  async saveCapabilities(workspaceId: string, matrix: unknown): Promise<void> {
    assertNoSecrets(matrix);
    const rec: CapabilityRecord = { workspaceId, probedAt: now(), matrix };
    await this.db.capabilities.put(rec);
  }

  getCapabilities(workspaceId: string): Promise<CapabilityRecord | undefined> {
    return this.db.capabilities.get(workspaceId);
  }

  private async touch(workspaceId: string): Promise<void> {
    await this.db.workspaces.update(workspaceId, { updatedAt: now() });
  }
}
