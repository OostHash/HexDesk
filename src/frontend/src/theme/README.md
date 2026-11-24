# Theme tokens

Colours live in three layers. Each layer only reads the one below it.

| Layer    | File         | Holds                                                     | Read by                        |
| -------- | ------------ | --------------------------------------------------------- | ------------------------------ |
| Palette  | `palette.ts` | Raw hex values in named families and steps                | `tokens.ts`, `domain.ts`       |
| Semantic | `tokens.ts`  | UI roles per theme (`bg`, `surface`, `accent`, `danger`…) | components, via Tailwind       |
| Domain   | `domain.ts`  | Warframe meanings (rarity, relic tiers, syndicates…)      | components, via `domainTone()` |

`pnpm tokens` writes `generated/*.css` from these files; `pnpm tokens:check`
fails when the generated CSS is out of date. Never edit `generated/`.

## Using colours in components

- Use the semantic Tailwind colours: `bg-surface`, `text-muted`,
  `border-border`, `bg-accent`, `text-danger`. Tailwind's own palette is
  switched off, so `bg-gray-800` does not exist.
- No hex, `rgb()` or arbitrary colour values in components.
- Domain colours are never chrome. Pass one to a tone-aware primitive:
  `<Badge tone="domain" style={domainTone("ducat")}>`.
- Status (`success`, `danger`, `warning`, `info`) always comes with a label
  or icon, so it does not rely on colour alone.

## Surfaces

From back to front:

| Role             | Use                                      |
| ---------------- | ---------------------------------------- |
| `bg`             | The page behind a screen                 |
| `panel`          | Window chrome: title bar, header, docks  |
| `nav`            | The main navigation                      |
| `surface`        | Cards, tables and controls on a page     |
| `surface-raised` | Popovers, menus, dialogs, toasts         |
| `surface-sunken` | A well inside a card                     |
| `field`          | The inside of an input, select or switch |

## States

Every interactive control uses the same roles for its states:

| State    | Look                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| Hover    | `bg-hover`; a filled button goes to `/90` of its own colour                                                |
| Pressed  | `bg-active`; a filled button goes to `/80`                                                                 |
| Selected | `border-accent bg-selected text-text`                                                                      |
| Focus    | global `:focus-visible` outline (`index.css`); own classes only after `outline-none` or for a hidden input |
| Disabled | `opacity-50`; text fields get `FIELD_DISABLED` instead                                                     |

`accent-soft` has the same value as `selected` but is a tint for emphasis,
such as a watched fissure, not a state. Selected always comes with the accent
border, so it does not rely on the fill alone.

## Palette families

- `graphite` (dark) and `stone` (light) are the neutrals. They are separate
  scales: the light theme is designed, not inverted.
- UI hues have two steps: `400` for dark pages and `700` for light pages.
  `amber` is the accent, `ochre` warning, `sage` success, `brick` danger and
  `steel` info. `ochre` leans towards yellow so a warning never reads as the
  accent.
- Domain hues (`bronze`, `silver`, `gold`, `violet`, `sky`) are shared by
  domain aliases that mean the same kind of thing, such as `rarity-gold`,
  `ducat` and `tier-neo`. Identity colours (syndicates, platinum, mastery,
  timer states) keep their own value in `domain.ts`.

## Adding a theme, palette or accessibility mode

- A theme is an entry in `themes` in `tokens.ts`. The `satisfies` checks make
  it define every role, a high-contrast variant and a colour-blind variant;
  CSS, the pre-paint script and the Settings choice follow.
- `contrastPairs` lists the foreground and background pairs that must meet
  WCAG contrast. `tests/tooling/tokens.test.ts` checks them for every theme,
  in normal and high contrast, with and without the colour-blind palette. Add
  a pair when a new role carries text.
- The colour-blind palette (`data-cvd="on"`) replaces the status roles per
  theme and the domain colours whose meaning rests on green versus red.
- The main window's `backgroundColor` in `src/backend/tauri.conf.json` must
  equal the default theme's `bg`; a test checks this.
