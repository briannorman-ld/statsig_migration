import Dexie, { type EntityTable } from 'dexie';
import type { CanonicalSnapshot, SourceDescriptor } from '@sslm/canonical';

/**
 * Browser state (PLAN §3.3 item 2). Tokens are never stored here: see assertNoSecrets.
 * Later milestones add tables (decisions, runs, journal, pre-images, waves, cutover samples) via
 * new Dexie versions; nothing here needs migrating for that.
 */

export interface WorkspaceRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
  /** The single LD target (PLAN §3.6): instance + project. No token. */
  ld?: { instance: 'us' | 'eu' | 'federal'; projectKey?: string };
  /** EU / Federal acknowledgement (PLAN §3.5), stored in the workspace. */
  instanceAcknowledgement?: { instance: 'eu' | 'federal'; acknowledgedAt: string };
}

export interface SourceRecord extends SourceDescriptor {
  workspaceId: string;
}

export interface SnapshotRecord {
  id: string;
  workspaceId: string;
  sourceId: string;
  takenAt: string;
  sourceKind: CanonicalSnapshot['source']['sourceKind'];
  /** Counts for list views without loading the whole snapshot. */
  summary: { gates: number; configs: number; segments: number; experiments: number; warnings: number };
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

export class MigratorDb extends Dexie {
  workspaces!: EntityTable<WorkspaceRecord, 'id'>;
  sources!: EntityTable<SourceRecord, 'id'>;
  snapshots!: EntityTable<SnapshotRecord, 'id'>;
  specUploads!: EntityTable<SpecUploadRecord, 'id'>;
  capabilities!: EntityTable<CapabilityRecord, 'workspaceId'>;

  constructor(name = 'statsig-ld-migrator') {
    super(name);
    this.version(1).stores({
      workspaces: 'id, updatedAt',
      sources: 'id, workspaceId',
      snapshots: 'id, workspaceId, sourceId, [sourceId+takenAt]',
      specUploads: 'id, workspaceId, sourceId, [sourceId+uploadedAt]',
      capabilities: 'workspaceId',
    });
  }
}
