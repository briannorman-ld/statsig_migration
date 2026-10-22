# Visual system

The console is a LaunchDarkly tool and should look like one. The styling has two layers, both
self-hosted so the CSP keeps `font-src 'self'` and `style-src 'self'` (no Google Fonts, no CDN).

## Layers

1. **LaunchPad UI tokens** (`@launchpad-ui/tokens`, LaunchDarkly's product design system). They
   provide the semantic palette with real light and dark values (`--lp-color-bg-ui-*`,
   `--lp-color-text-ui-*`, `--lp-color-border-ui-*`, feedback and interactive tokens), the
   self-hosted Inter variable font, radii, durations and the brand gradients. Dark mode is
   `[data-theme='dark']` on `<html>`, which is what LaunchPad itself uses.
2. **2026 brand layer**, from the `launchdarkly-brand-style` skill
   (`launchdarkly-labs/ps-agent-skills`, `plugins/sa-tools/skills/launchdarkly-brand-style`):
   Sora bold for display headings (`@fontsource/sora`, weights 600 and 700), Inter for everything
   else, the Osmo mark and primary lock-up as inline SVG (`components/Brand.tsx`), and the named
   gradients (purple → blue, cyan → blue) used only on the hero title and one accent rule.

`apps/web/src/index.css` maps the LaunchPad tokens onto Tailwind utilities. Use these names, not
raw palette classes (`slate-500`, `emerald-50`, …), so both themes stay correct:

| Utility | Meaning |
| --- | --- |
| `bg-canvas` / `bg-surface` / `bg-surface-2` | page, card, inset (table heads, hover rows) |
| `text-fg` / `text-fg-muted` / `text-fg-subtle` | primary, secondary and tertiary text |
| `border-line` / `border-line-soft` / `border-line-strong` | default, hairline (dividers), hover |
| `bg-accent text-on-accent`, `text-link`, `ring-focus` | primary action, links, focus |
| `bg-selected text-selected-fg` | selected nav item, tab, tile |
| `*-success`, `*-warning`, `*-error`, `*-info`, `*-purple` with `-bg`, `-line`, `-fill` | status |
| `text-logo` | LD Black in light, White in dark; the only colours the logo may use |
| `font-display` | Sora, for page titles and the hero only |
| `text-gradient-brand`, `bg-gradient-brand` | purple → blue brand gradient |

`components/ui.tsx` keeps the historical tone names (`slate`, `green`, `amber`, `red`, `blue`,
`violet`) on `Badge`, `Dot` and `Callout`; they resolve to the status tokens above.

## Theme switching

`lib/theme.ts` owns the preference (`system`, `light`, `dark`), persisted in `localStorage`
under `sslm.theme`. It is applied in `main.tsx` before the first render (the CSP forbids an
inline script) and follows `prefers-color-scheme` while on `system`. `ThemeToggle` is the
segmented control in the start screen header and the workspace header. Native controls follow
through `color-scheme`.

## Brand rules that apply here

- Logo and mark only in LD Black `#191919` or White; never tinted, stretched or gradient-filled.
  Prefer the full lock-up when there is room (start screen); the mark alone in the header.
- Gradients use base colours only, two or three stops, and appear where emphasis is earned.
- Status never relies on colour alone: every dot and badge carries a label.
- Dark mode gets depth from layered surfaces and a faint glow, not heavy shadows; light mode uses
  white cards on a cool gray canvas with crisp hairlines.
