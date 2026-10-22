import { THEME_PREFERENCES, useTheme, type ThemePreference } from '../lib/theme.ts';
import { cx } from './ui.tsx';

const LABEL: Record<ThemePreference, string> = { system: 'Match system', light: 'Light', dark: 'Dark' };

/** Segmented System / Light / Dark control. Compact enough for the workspace header. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <div role="group" aria-label="Color theme" className={cx('inline-flex items-center rounded-md border border-line bg-surface p-0.5 shadow-card', className)}>
      {THEME_PREFERENCES.map((p) => {
        const active = preference === p;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={active}
            title={LABEL[p]}
            onClick={() => setPreference(p)}
            className={cx(
              'inline-flex h-7 w-7 items-center justify-center rounded-[5px] text-fg-muted transition-colors duration-150',
              active ? 'bg-selected text-selected-fg' : 'hover:bg-surface-hover hover:text-fg',
            )}
          >
            <Icon kind={p} />
            <span className="sr-only">{LABEL[p]}</span>
          </button>
        );
      })}
    </div>
  );
}

function Icon({ kind }: { kind: ThemePreference }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
  if (kind === 'light')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );
  if (kind === 'dark')
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}
