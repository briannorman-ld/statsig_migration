import { beforeEach, describe, expect, it, vi } from 'vitest';

function mockMatchMedia(prefersDark: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark') && prefersDark, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

describe('theme', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.head.innerHTML = '<meta name="theme-color" content="#f7f9fb">';
  });

  it('follows the OS until the user picks a theme', async () => {
    mockMatchMedia(true);
    const t = await import('./theme.ts');
    expect(t.getThemePreference()).toBe('system');
    expect(t.resolveTheme('system', true)).toBe('dark');
    expect(t.resolveTheme('system', false)).toBe('light');
    expect(t.resolveTheme('light', true)).toBe('light');
    t.initTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe('#181a1f');
  });

  it('persists an explicit choice and clears it on "system"', async () => {
    mockMatchMedia(false);
    const t = await import('./theme.ts');
    t.setThemePreference('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(t.THEME_STORAGE_KEY)).toBe('dark');
    t.setThemePreference('system');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(t.THEME_STORAGE_KEY)).toBeNull();
  });

  it('reads a stored preference on load and ignores junk', async () => {
    mockMatchMedia(true);
    localStorage.setItem('sslm.theme', 'light');
    let t = await import('./theme.ts');
    expect(t.getThemePreference()).toBe('light');
    expect(t.applyTheme()).toBe('light');
    vi.resetModules();
    localStorage.setItem('sslm.theme', 'sepia');
    t = await import('./theme.ts');
    expect(t.getThemePreference()).toBe('system');
  });
});
