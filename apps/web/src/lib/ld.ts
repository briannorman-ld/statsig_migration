import { useSyncExternalStore } from 'react';
import { LdAuthError, LdClient, probeCapabilities, type CapabilityMatrix, type LdCallerIdentity, type LdFlagSummary, type LdInstanceId, type LdProject, type LdSegment } from '@sslm/ld-client';
import { secrets } from './secrets.ts';
import { store } from './store.ts';

/**
 * LD connection for a workspace. The token lives in the secrets vault (memory only); this state
 * holds only non-secret results. Everything here reads; writes go through the executor
 * (lib/migration.ts) after the user confirms a plan.
 */
export interface LdSession {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  instance?: LdInstanceId;
  identity?: LdCallerIdentity;
  projects?: LdProject[];
  projectKey?: string;
  matrix?: CapabilityMatrix;
  probing?: string;
  /** Every flag with all environments (on/off, provenance custom properties). */
  flags?: { items: LdFlagSummary[]; loadedAt: string };
  contextKinds?: string[];
  /** Segments per LD environment, loaded when a plan needs them. */
  segments?: Record<string, LdSegment[]>;
  error?: string;
}

const sessions = new Map<string, LdSession>();
const clients = new Map<string, LdClient>();
const listeners = new Set<() => void>();
const EMPTY: LdSession = { status: 'disconnected' };

function set(workspaceId: string, patch: Partial<LdSession>) {
  sessions.set(workspaceId, { ...(sessions.get(workspaceId) ?? EMPTY), ...patch });
  listeners.forEach((l) => l());
}

export function useLdSession(workspaceId: string): LdSession {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sessions.get(workspaceId) ?? EMPTY,
  );
}

export function ldClient(workspaceId: string): LdClient {
  return client(workspaceId);
}

function client(workspaceId: string): LdClient {
  const c = clients.get(workspaceId);
  if (!c) throw new Error('Not connected to LaunchDarkly.');
  return c;
}

/** Validate the token (caller identity) and list projects. */
export async function connectLd(workspaceId: string, instance: LdInstanceId, token: string): Promise<void> {
  set(workspaceId, { status: 'connecting', instance, error: undefined, matrix: undefined, flags: undefined });
  const c = new LdClient({ instance, token });
  try {
    const identity = await c.callerIdentity();
    const projects = await c.listProjects();
    secrets.set('ld', workspaceId, token);
    clients.set(workspaceId, c);
    set(workspaceId, { status: 'connected', identity, projects });
    // Keep the workspace's chosen project (e.g. the demo's) and probe it straight away.
    const saved = (await store.getWorkspace(workspaceId))?.ld;
    const keep = saved?.instance === instance && saved.projectKey && projects.some((p) => p.key === saved.projectKey) ? saved.projectKey : undefined;
    await store.updateWorkspace(workspaceId, { ld: { instance, ...(keep ? { projectKey: keep } : {}) } });
    if (keep) await chooseProject(workspaceId, keep);
    else if (saved?.projectKey) set(workspaceId, { error: `Project "${saved.projectKey}" isn't visible to this token on ${instance}; choose another.` });
  } catch (e) {
    set(workspaceId, { status: 'error', error: e instanceof LdAuthError ? e.message : `Could not reach LaunchDarkly: ${(e as Error).message}` });
  }
}

export async function chooseProject(workspaceId: string, projectKey: string): Promise<void> {
  const c = client(workspaceId);
  set(workspaceId, { projectKey, probing: 'Starting', matrix: undefined, flags: undefined, error: undefined });
  try {
    const matrix = await probeCapabilities(c, projectKey, { onProgress: (s) => set(workspaceId, { probing: s }) });
    set(workspaceId, { matrix, probing: undefined });
    await store.updateWorkspace(workspaceId, { ld: { instance: c.instance.id, projectKey } });
    await store.saveCapabilities(workspaceId, matrix);
    await refreshLdState(workspaceId);
  } catch (e) {
    set(workspaceId, { probing: undefined, error: `Capability probe failed: ${(e as Error).message}` });
  }
}

export async function reprobe(workspaceId: string): Promise<void> {
  const s = sessions.get(workspaceId);
  if (s?.projectKey) await chooseProject(workspaceId, s.projectKey);
}

/** Re-read flags (all environments) and context kinds: after connecting and after every run. */
export async function refreshLdState(workspaceId: string, opts: { segmentEnvs?: string[] } = {}): Promise<void> {
  const s = sessions.get(workspaceId);
  if (!s?.projectKey) return;
  const c = client(workspaceId);
  try {
    const [items, kinds] = await Promise.all([c.listFlags(s.projectKey), c.listContextKinds(s.projectKey)]);
    const segments = { ...(sessions.get(workspaceId)?.segments ?? {}) };
    for (const env of opts.segmentEnvs ?? Object.keys(segments)) segments[env] = await c.listSegments(s.projectKey, env);
    set(workspaceId, { flags: { items, loadedAt: new Date().toISOString() }, contextKinds: kinds.items.filter((k) => !k.archived).map((k) => k.key), segments });
  } catch (e) {
    set(workspaceId, { error: `Could not read the LD project: ${(e as Error).message}` });
  }
}

export function disconnectLd(workspaceId: string): void {
  secrets.forget('ld', workspaceId);
  clients.delete(workspaceId);
  sessions.delete(workspaceId);
  listeners.forEach((l) => l());
}
