import { useSyncExternalStore } from 'react';
import { LdAuthError, LdClient, probeCapabilities, type CapabilityMatrix, type LdCallerIdentity, type LdFlagSummary, type LdInstanceId, type LdProject } from '@sslm/ld-client';
import { secrets } from './secrets.ts';
import { store } from './store.ts';

/**
 * LD connection for a workspace. The token lives in the secrets vault (memory only); this state
 * holds only non-secret results. Everything here is a READ: no LD writes in this milestone.
 */
export interface LdSession {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  instance?: LdInstanceId;
  identity?: LdCallerIdentity;
  projects?: LdProject[];
  projectKey?: string;
  matrix?: CapabilityMatrix;
  probing?: string;
  flags?: { envKey: string; items: LdFlagSummary[]; loadedAt: string };
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
    await store.updateWorkspace(workspaceId, { ld: { instance } });
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
  } catch (e) {
    set(workspaceId, { probing: undefined, error: `Capability probe failed: ${(e as Error).message}` });
  }
}

export async function reprobe(workspaceId: string): Promise<void> {
  const s = sessions.get(workspaceId);
  if (s?.projectKey) await chooseProject(workspaceId, s.projectKey);
}

export async function loadLdFlags(workspaceId: string, envKey: string): Promise<void> {
  const s = sessions.get(workspaceId);
  if (!s?.projectKey) return;
  try {
    const items = await client(workspaceId).listFlags(s.projectKey, { envKey });
    set(workspaceId, { flags: { envKey, items, loadedAt: new Date().toISOString() } });
  } catch (e) {
    set(workspaceId, { error: `Could not list LD flags: ${(e as Error).message}` });
  }
}

export function disconnectLd(workspaceId: string): void {
  secrets.forget('ld', workspaceId);
  clients.delete(workspaceId);
  sessions.delete(workspaceId);
  listeners.forEach((l) => l());
}
