import { useSyncExternalStore } from 'react';

/**
 * Easter egg: a "migrate LaunchDarkly → StatSig" wizard that is all friction and ends with a
 * phone number. It is hidden unless this browser has `localStorage.ldtoss === "true"`, set by
 * hand in devtools. Nothing in the flow reads or writes workspace data, LaunchDarkly or StatSig,
 * and the answers typed into it are never kept (see screens/ReverseMigration.tsx).
 */
export const LDTOSS_KEY = 'ldtoss';
export const REVERSE_MIGRATION_HASH = '#/toss';

export function isLdTossEnabled(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(LDTOSS_KEY) === 'true';
  } catch {
    return false;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

// The same tab gets no `storage` event for its own writes, so re-read on focus too: flipping the
// key in devtools and clicking back into the page is enough, no reload needed.
function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener('focus', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('focus', onChange);
  };
}

export function useLdToss(): boolean {
  return useSyncExternalStore(subscribe, () => isLdTossEnabled(), () => false);
}

export function openReverseMigration(): void {
  window.location.hash = REVERSE_MIGRATION_HASH;
}
