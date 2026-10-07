/**
 * In-memory token vault (PLAN §3.4). Tokens live only in this module's Map: never in React
 * state snapshots, IndexedDB, workspace files, URLs or logs. Closing the tab forgets them.
 * TODO(M0): optional "Remember on this device" (AES-GCM + PBKDF2 passphrase vault in IndexedDB).
 */
type SecretKind = 'statsig' | 'ld';

const vault = new Map<string, string>();
const listeners = new Set<() => void>();
const key = (kind: SecretKind, id: string) => `${kind}:${id}`;

export const secrets = {
  set(kind: SecretKind, id: string, value: string): void {
    vault.set(key(kind, id), value);
    listeners.forEach((l) => l());
  },
  get(kind: SecretKind, id: string): string | undefined {
    return vault.get(key(kind, id));
  },
  has(kind: SecretKind, id: string): boolean {
    return vault.has(key(kind, id));
  },
  forget(kind: SecretKind, id: string): void {
    vault.delete(key(kind, id));
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
