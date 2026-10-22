import { useSyncExternalStore } from 'react';

/**
 * Light / dark theme. LaunchPad tokens switch on `data-theme` on <html>; the user's choice is one
 * of `light`, `dark` or `system` (follow prefers-color-scheme) and is persisted in localStorage.
 * It's a display preference, not workspace state, so it lives outside IndexedDB and workspaces.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'sslm.theme';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const listeners = new Set<() => void>();
let preference: ThemePreference = readStoredPreference();

function readStoredPreference(): ThemePreference {
  try {
    const v = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The theme that `preference` means right now, given the OS setting. */
export function resolveTheme(pref: ThemePreference, prefersDark: boolean = systemPrefersDark()): ResolvedTheme {
  return pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref;
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(preference);
}

/** Write the resolved theme to <html> (and the browser chrome's theme-color). */
export function applyTheme(pref: ThemePreference = preference): ResolvedTheme {
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (meta) meta.content = resolved === 'dark' ? '#181a1f' : '#f7f9fb';
  return resolved;
}

export function setThemePreference(pref: ThemePreference): void {
  preference = pref;
  try {
    if (pref === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Private mode or blocked storage: the choice still applies for this page.
  }
  applyTheme(pref);
  for (const l of listeners) l();
}

/** Apply the stored preference before first render and keep following the OS while on `system`. */
export function initTheme(): void {
  applyTheme();
  if (typeof matchMedia !== 'function') return;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (preference !== 'system') return;
    applyTheme();
    for (const l of listeners) l();
  };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else mq.addListener(onChange);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTheme(): { preference: ThemePreference; resolved: ResolvedTheme; setPreference: (p: ThemePreference) => void } {
  const pref = useSyncExternalStore(subscribe, getThemePreference, () => 'system' as const);
  const resolved = useSyncExternalStore(subscribe, getResolvedTheme, () => 'light' as const);
  return { preference: pref, resolved, setPreference: setThemePreference };
}
