import Dexie, { type EntityTable } from "dexie";
import type { CanonicalSnapshot, SourceDescriptor } from "@sslm/canonical";
import type { MappingProfile, Resolution } from "@sslm/mapper";
import type { RunRecord } from "@sslm/executor";

/**
 * Browser state (PLAN §3.3 item 2). Tokens are never stored here: see assertNoSecrets.
 * Version 2 (M3) adds the mapping profile, resolutions, the run journal (with pre-images) and
 * fetched ID lists. Later milestones add waves and cutover samples the same way.
 */

export interface WorkspaceRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
  /** The single LD target (PLAN §3.6): instance + project. No token. */
  ld?: { instance: "us" | "eu" | "federal"; projectKey?: string };
  /** EU / Federal acknowledgement (PLAN §3.5), stored in the workspace. */
  instanceAcknowledgement?: {
    instance: "eu" | "federal";
    acknowledgedAt: string;
  };
  /** Snapshots kept per source after each sync (plus any a run used). Undefined = DEFAULT_SNAPSHOT_RETENTION. */
  snapshotRetention?: number;
}

export interface SourceRecord extends SourceDescriptor {
  workspaceId: string;
}

export interface SnapshotRecord {
  id: string;
  workspaceId: string;
  sourceId: string;
  takenAt: string;
  sourceKind: CanonicalSnapshot["source"]["sourceKind"];
  /** Counts for list views without loading the whole snapshot. */
  summary: {
    gates: number;
    configs: number;
    segments: number;
    experiments: number;
    warnings: number;
  };
  /** Approximate size of `canonical` as JSON, for the storage view. Absent on records saved before it was tracked. */
  bytes?: number;
  canonical: CanonicalSnapshot;
}

/** Raw spec uploads, versioned per source (PLAN §4.2 "Every upload becomes a new immutable snapshot"). */
export interface SpecUploadRecord {
  id: string;
  workspaceId: string;
  sourceId: string;
  uploadedAt: string;
  filename: string;
  bytes: number;
  version: 1 | 2;
  /** Parsed JSON. Contains salts and possibly PII: stays local, never in logs. */
  json: unknown;
  snapshotId: string;
}

export interface CapabilityRecord {
  workspaceId: string;
  probedAt: string;
  /** CapabilityMatrix from @sslm/ld-client (kept structural here to avoid a package cycle). */
  matrix: unknown;
}

/** The mapping profile (PLAN §8.1): one per workspace. */
export interface ProfileRecord {
  workspaceId: string;
  updatedAt: string;
  profile: MappingProfile;
}

export interface ResolutionRecord extends Resolution {
  workspaceId: string;
}

/** Run journal (PLAN §9 step 6): written before and after every step. Holds pre-images for undo. */
export interface RunJournalRecord extends RunRecord {
  /** The snapshots the run was planned from. Those snapshots are never pruned while the run exists. */
  snapshots?: { sourceId: string; takenAt: string }[];
}

/** ID lists fetched on demand for segments the crawl deferred (PLAN §4.1). Customer data: local only. */
export interface IdListRecord {
  /** Segment uid. */
  uid: string;
  workspaceId: string;
  sourceId: string;
  fetchedAt: string;
  ids: string[];
}

export class MigratorDb extends Dexie {
  workspaces!: EntityTable<WorkspaceRecord, "id">;
  sources!: EntityTable<SourceRecord, "id">;
  snapshots!: EntityTable<SnapshotRecord, "id">;
  specUploads!: EntityTable<SpecUploadRecord, "id">;
  capabilities!: EntityTable<CapabilityRecord, "workspaceId">;
  profiles!: EntityTable<ProfileRecord, "workspaceId">;
  resolutions!: Dexie.Table<ResolutionRecord, [string, string]>;
  runs!: EntityTable<RunJournalRecord, "id">;
  idLists!: EntityTable<IdListRecord, "uid">;

  constructor(name = "statsig-ld-migrator") {
    super(name);
    this.version(1).stores({
      workspaces: "id, updatedAt",
      sources: "id, workspaceId",
      snapshots: "id, workspaceId, sourceId, [sourceId+takenAt]",
      specUploads: "id, workspaceId, sourceId, [sourceId+uploadedAt]",
      capabilities: "workspaceId",
    });
    // M3: decisions, mapping profile, run journal, fetched ID lists.
    this.version(2).stores({
      profiles: "workspaceId",
      resolutions: "[workspaceId+id], workspaceId",
      runs: "id, workspaceId, startedAt, [workspaceId+startedAt]",
      idLists: "uid, workspaceId, sourceId",
    });
    // Snapshot history: raw uploads are looked up by snapshot when old snapshots are pruned.
    this.version(3).stores({
      specUploads:
        "id, workspaceId, sourceId, snapshotId, [sourceId+uploadedAt]",
    });
  }
}
