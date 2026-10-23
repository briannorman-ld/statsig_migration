import type { CanonicalSnapshot, SourceDescriptor } from "@sslm/canonical";
import type { MappingProfile, Resolution } from "@sslm/mapper";
import type { RunRecord } from "@sslm/executor";
import {
  MigratorDb,
  type CapabilityRecord,
  type IdListRecord,
  type ProfileRecord,
  type RunJournalRecord,
  type SnapshotRecord,
  type SourceRecord,
  type SpecUploadRecord,
  type WorkspaceRecord,
} from "./db.ts";

/** Property names that must never be persisted (CLAUDE.md: tokens never persisted unencrypted). */
const SECRET_KEYS =
  /^(token|apiKey|api_key|statsigApiKey|consoleKey|clientKey|ldToken|accessToken|authorization|secret|password|sdkKey|mobileKey)$/i;

export class SecretInStoreError extends Error {
  constructor(path: string) {
    super(
      `Refusing to persist a secret-looking field at ${path}. Tokens stay in memory.`,
    );
    this.name = "SecretInStoreError";
  }
}

/** Throws if any object key anywhere in `value` looks like a credential. */
export function assertNoSecrets(value: unknown, path = "$", depth = 0): void {
  if (depth > 12 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    // Snapshots can hold large arrays (ID lists); only objects can carry secret keys.
    for (let i = 0; i < value.length; i++)
      if (value[i] && typeof value[i] === "object")
        assertNoSecrets(value[i], `${path}[${i}]`, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.test(k) && v !== undefined && v !== null && v !== "")
      throw new SecretInStoreError(`${path}.${k}`);
    assertNoSecrets(v, `${path}.${k}`, depth + 1);
  }
}

const now = () => new Date().toISOString();

/** UTF-16 code units of the JSON; close enough to bytes for a storage readout, and cheap (one stringify). */
export function approximateJsonBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

export class DuplicateWorkspaceNameError extends Error {
  constructor(readonly workspaceName: string) {
    super(`A workspace named “${workspaceName}” already exists.`);
    this.name = "DuplicateWorkspaceNameError";
  }
}

/** Names compare trimmed and case-insensitively: "Contoso" and "contoso " are the same workspace to a person. */
export const normalizeWorkspaceName = (name: string) =>
  name.trim().toLocaleLowerCase();

export class WorkspaceStore {
  constructor(readonly db: MigratorDb = new MigratorDb()) {}

  async createWorkspace(input: {
    id?: string;
    name: string;
    isDemo?: boolean;
    ld?: WorkspaceRecord["ld"];
  }): Promise<WorkspaceRecord> {
    const name = input.name.trim();
    const ws: WorkspaceRecord = {
      id: input.id ?? crypto.randomUUID(),
      name,
      isDemo: input.isDemo ?? false,
      createdAt: now(),
      updatedAt: now(),
      ...(input.ld ? { ld: input.ld } : {}),
    };
    assertNoSecrets(ws);
    await this.db.transaction("rw", this.db.workspaces, async () => {
      if (await this.findWorkspaceByName(name, ws.id))
        throw new DuplicateWorkspaceNameError(name);
      await this.db.workspaces.put(ws);
    });
    return ws;
  }

  /** The workspace with this name (trimmed, case-insensitive), ignoring `exceptId`. */
  async findWorkspaceByName(
    name: string,
    exceptId?: string,
  ): Promise<WorkspaceRecord | undefined> {
    const key = normalizeWorkspaceName(name);
    const all = await this.db.workspaces.toArray();
    return all.find(
      (w) => w.id !== exceptId && normalizeWorkspaceName(w.name) === key,
    );
  }

  listWorkspaces(): Promise<WorkspaceRecord[]> {
    return this.db.workspaces.orderBy("updatedAt").reverse().toArray();
  }

  getWorkspace(id: string): Promise<WorkspaceRecord | undefined> {
    return this.db.workspaces.get(id);
  }

  async updateWorkspace(
    id: string,
    patch: Partial<Omit<WorkspaceRecord, "id" | "createdAt">>,
  ): Promise<void> {
    assertNoSecrets(patch);
    if (patch.name !== undefined) {
      patch = { ...patch, name: patch.name.trim() };
      if (await this.findWorkspaceByName(patch.name!, id))
        throw new DuplicateWorkspaceNameError(patch.name!);
    }
    await this.db.workspaces.update(id, { ...patch, updatedAt: now() });
  }

  /** Deletes the workspace and everything under it. */
  async deleteWorkspace(id: string): Promise<void> {
    const tables = [
      this.db.workspaces,
      this.db.sources,
      this.db.snapshots,
      this.db.specUploads,
      this.db.capabilities,
      this.db.profiles,
      this.db.resolutions,
      this.db.runs,
      this.db.idLists,
    ];
    await this.db.transaction("rw", tables, async () => {
      await this.db.profiles.delete(id);
      await this.db.resolutions.where("workspaceId").equals(id).delete();
      await this.db.runs.where("workspaceId").equals(id).delete();
      await this.db.idLists.where("workspaceId").equals(id).delete();
      await this.db.sources.where("workspaceId").equals(id).delete();
      await this.db.snapshots.where("workspaceId").equals(id).delete();
      await this.db.specUploads.where("workspaceId").equals(id).delete();
      await this.db.capabilities.delete(id);
      await this.db.workspaces.delete(id);
    });
  }

  async addSource(
    workspaceId: string,
    source: SourceDescriptor,
  ): Promise<SourceRecord> {
    const rec: SourceRecord = { ...source, workspaceId };
    assertNoSecrets(rec);
    await this.db.sources.put(rec);
    await this.touch(workspaceId);
    return rec;
  }

  listSources(workspaceId: string): Promise<SourceRecord[]> {
    return this.db.sources
      .where("workspaceId")
      .equals(workspaceId)
      .sortBy("createdAt");
  }

  /** Removes a source and everything fetched from it (snapshots, raw uploads, ID lists). */
  async removeSource(sourceId: string): Promise<void> {
    const src = await this.db.sources.get(sourceId);
    await this.db.transaction(
      "rw",
      [
        this.db.sources,
        this.db.snapshots,
        this.db.specUploads,
        this.db.idLists,
      ],
      async () => {
        await this.db.snapshots.where("sourceId").equals(sourceId).delete();
        await this.db.specUploads.where("sourceId").equals(sourceId).delete();
        await this.db.idLists.where("sourceId").equals(sourceId).delete();
        await this.db.sources.delete(sourceId);
      },
    );
    if (src) await this.touch(src.workspaceId);
  }

  /** How many snapshots a source keeps by default; see pruneSnapshots. */
  static readonly DEFAULT_SNAPSHOT_RETENTION = 10;

  /** Snapshots are immutable: each save is a new record. */
  async saveSnapshot(
    workspaceId: string,
    snapshot: CanonicalSnapshot,
  ): Promise<SnapshotRecord> {
    // No assertNoSecrets here: snapshots hold customer config values, which may legitimately
    // have keys like "token". Our credentials can only reach the records we shape ourselves.
    const rec: SnapshotRecord = {
      id: crypto.randomUUID(),
      workspaceId,
      sourceId: snapshot.source.sourceId,
      takenAt: snapshot.takenAt,
      sourceKind: snapshot.source.sourceKind,
      summary: {
        gates: snapshot.gates.length,
        configs: snapshot.configs.length,
        segments: snapshot.segments.length,
        experiments: snapshot.experiments.length,
        warnings: snapshot.warnings.length,
      },
      bytes: approximateJsonBytes(snapshot),
      canonical: snapshot,
    };
    await this.db.snapshots.add(rec);
    await this.touch(workspaceId);
    return rec;
  }

  getSnapshot(id: string): Promise<SnapshotRecord | undefined> {
    return this.db.snapshots.get(id);
  }

  /**
   * Keeps the newest `keep` snapshots of a source plus every snapshot a migration run in the
   * workspace was planned from, and deletes the rest (with their raw spec uploads). Returns the
   * ids removed. Nothing in StatSig or LD is affected: this is local history only.
   */
  async pruneSnapshots(
    workspaceId: string,
    sourceId: string,
    keep: number = WorkspaceStore.DEFAULT_SNAPSHOT_RETENTION,
  ): Promise<string[]> {
    if (!Number.isFinite(keep) || keep < 1) return [];
    return this.db.transaction(
      "rw",
      [this.db.snapshots, this.db.specUploads, this.db.runs],
      async () => {
        const runs = await this.db.runs
          .where("workspaceId")
          .equals(workspaceId)
          .toArray();
        const protectedTimes = new Set(
          runs.flatMap((r) =>
            (r.snapshots ?? [])
              .filter((s) => s.sourceId === sourceId)
              .map((s) => s.takenAt),
          ),
        );
        const all = await this.db.snapshots
          .where("[sourceId+takenAt]")
          .between([sourceId, ""], [sourceId, "￿"])
          .reverse()
          .toArray();
        const doomed = all
          .slice(keep)
          .filter((s) => !protectedTimes.has(s.takenAt));
        if (doomed.length === 0) return [];
        const ids = doomed.map((s) => s.id);
        await this.db.specUploads.where("snapshotId").anyOf(ids).delete();
        await this.db.snapshots.bulkDelete(ids);
        return ids;
      },
    );
  }

  async latestSnapshot(sourceId: string): Promise<SnapshotRecord | undefined> {
    return this.db.snapshots
      .where("[sourceId+takenAt]")
      .between([sourceId, ""], [sourceId, "￿"])
      .last();
  }

  /** Newest first, without the canonical payload. */
  async listSnapshots(
    sourceId: string,
  ): Promise<Omit<SnapshotRecord, "canonical">[]> {
    const all = await this.db.snapshots
      .where("[sourceId+takenAt]")
      .between([sourceId, ""], [sourceId, "￿"])
      .reverse()
      .toArray();
    return all.map(({ canonical: _c, ...rest }) => rest);
  }

  async saveSpecUpload(
    rec: Omit<SpecUploadRecord, "id" | "uploadedAt">,
  ): Promise<SpecUploadRecord> {
    const full: SpecUploadRecord = {
      ...rec,
      id: crypto.randomUUID(),
      uploadedAt: now(),
    };
    await this.db.specUploads.add(full);
    return full;
  }

  listSpecUploads(sourceId: string): Promise<SpecUploadRecord[]> {
    return this.db.specUploads
      .where("[sourceId+uploadedAt]")
      .between([sourceId, ""], [sourceId, "￿"])
      .reverse()
      .toArray();
  }

  async saveCapabilities(workspaceId: string, matrix: unknown): Promise<void> {
    assertNoSecrets(matrix);
    const rec: CapabilityRecord = { workspaceId, probedAt: now(), matrix };
    await this.db.capabilities.put(rec);
  }

  getCapabilities(workspaceId: string): Promise<CapabilityRecord | undefined> {
    return this.db.capabilities.get(workspaceId);
  }

  // --- Mapping profile and decisions (PLAN §8) --------------------------------------------------

  async getProfile(workspaceId: string): Promise<MappingProfile | undefined> {
    return (await this.db.profiles.get(workspaceId))?.profile;
  }

  async saveProfile(
    workspaceId: string,
    profile: MappingProfile,
  ): Promise<void> {
    const rec: ProfileRecord = { workspaceId, updatedAt: now(), profile };
    assertNoSecrets(rec);
    await this.db.profiles.put(rec);
  }

  async listResolutions(workspaceId: string): Promise<Resolution[]> {
    return (
      await this.db.resolutions
        .where("workspaceId")
        .equals(workspaceId)
        .toArray()
    ).map(({ workspaceId: _w, ...r }) => r);
  }

  async saveResolutions(
    workspaceId: string,
    resolutions: Resolution[],
  ): Promise<void> {
    const recs = resolutions.map((r) => ({ ...r, workspaceId }));
    assertNoSecrets(recs);
    await this.db.resolutions.bulkPut(recs);
  }

  async deleteResolutions(workspaceId: string, ids: string[]): Promise<void> {
    await this.db.resolutions.bulkDelete(
      ids.map((id) => [workspaceId, id] as [string, string]),
    );
  }

  // --- Run journal (PLAN §9 step 6, §15) --------------------------------------------------------

  /**
   * Called before and after every step. No assertNoSecrets: pre-images are LD flag/segment
   * configurations, whose JSON values are customer data (like snapshots), not our credentials.
   */
  async saveRun(run: RunJournalRecord): Promise<void> {
    await this.db.runs.put(run);
  }

  getRun(id: string): Promise<RunJournalRecord | undefined> {
    return this.db.runs.get(id);
  }

  /** Newest first. */
  listRuns(workspaceId: string): Promise<RunJournalRecord[]> {
    return this.db.runs
      .where("[workspaceId+startedAt]")
      .between([workspaceId, ""], [workspaceId, "￿"])
      .reverse()
      .toArray();
  }

  // --- On-demand ID lists ---------------------------------------------------------------------

  async saveIdList(rec: IdListRecord): Promise<void> {
    await this.db.idLists.put(rec);
  }

  async listIdLists(workspaceId: string): Promise<IdListRecord[]> {
    return this.db.idLists.where("workspaceId").equals(workspaceId).toArray();
  }

  private async touch(workspaceId: string): Promise<void> {
    await this.db.workspaces.update(workspaceId, { updatedAt: now() });
  }
}
