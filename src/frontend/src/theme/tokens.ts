import { palette } from "./palette.ts";

/**
 * Layer 2: semantic roles, the only colours primitives know.
 * Every theme must define every role; the `satisfies` checks enforce it.
 */
export const semanticTokens = [
  "bg",
  "panel",
  "nav",
  "surface",
  "surface-raised",
  "surface-sunken",
  "field",
  "border",
  "border-strong",
  "text",
  "text-muted",
  "text-faint",
  "accent",
  "accent-soft",
  "on-accent",
  "success",
  "danger",
  "on-danger",
  "warning",
  "info",
  "focus-ring",
  "hover",
  "active",
  "selected",
  "backdrop",
  "shadow-1",
  "shadow-2",
  "shadow-3",
  "shadow-dock",
  "tone-ink",
] as const;

export type SemanticToken = (typeof semanticTokens)[number];
export type ThemeTokens = Readonly<Record<SemanticToken, string>>;

/**
 * Interaction states derive from text/accent, so they invert with the theme.
 * text-faint is for disabled controls and placeholders only (WCAG exempts
 * those from contrast); never for readable content.
 */
const derived = {
  "border-strong": "color-mix(in oklab, var(--hex-text) 28%, transparent)",
  "text-faint": "color-mix(in oklab, var(--hex-text-muted) 70%, transparent)",
  "accent-soft": "color-mix(in oklab, var(--hex-accent) 14%, transparent)",
  "focus-ring": "var(--hex-accent)",
  hover: "color-mix(in oklab, var(--hex-text) 6%, transparent)",
  active: "color-mix(in oklab, var(--hex-text) 10%, transparent)",
  selected: "color-mix(in oklab, var(--hex-accent) 14%, transparent)",
} as const satisfies Partial<ThemeTokens>;

/** Accent presets the player can pick in Settings → Appearance; amber is the default. */
export const ACCENTS = ["amber", "teal", "violet", "rose", "steel"] as const;
export type AccentName = (typeof ACCENTS)[number];
export const DEFAULT_ACCENT: AccentName = "amber";

/**
 * The accent of each preset per theme. Every value meets the accent pairs in
 * contrastPairs on its theme; high contrast keeps its own accent.
 */
export const accentPresets = {
  amber: { dark: palette.amber[400], light: palette.amber[700] },
  teal: { dark: palette.teal[400], light: palette.teal[700] },
  violet: { dark: palette.iris[400], light: palette.iris[700] },
  rose: { dark: palette.rose[400], light: palette.rose[700] },
  steel: { dark: palette.azure[400], light: palette.azure[700] },
} as const satisfies Record<AccentName, Record<"dark" | "light", string>>;

/**
 * Surfaces from back to front: bg is the page, panel the window chrome (title
 * bar, header, docks), nav the main navigation, surface the cards and controls
 * on a page, surface-raised popovers and dialogs. surface-sunken is a well
 * inside a card; field is the inside of an input.
 */
const g = palette.graphite;

export const dark = {
  ...derived,
  bg: g[950],
  panel: g[900],
  nav: g[1000],
  surface: g[800],
  "surface-raised": g[750],
  "surface-sunken": g[925],
  field: g[925],
  border: g[700],
  text: g[100],
  "text-muted": g[400],
  accent: accentPresets[DEFAULT_ACCENT].dark,
  "on-accent": g[950],
  "on-danger": g[950],
  success: palette.sage[400],
  danger: palette.brick[400],
  warning: palette.ochre[400],
  info: palette.steel[400],
  backdrop: "rgb(0 0 0 / 0.6)",
  "shadow-1": "0 1px 2px rgb(0 0 0 / 0.3)",
  "shadow-2": "0 8px 24px rgb(0 0 0 / 0.45)",
  "shadow-3": "0 20px 60px rgb(0 0 0 / 0.6)",
  /** The open changelog dock lifts above the screen it covers. */
  "shadow-dock": "0 -8px 24px rgb(0 0 0 / 0.4)",
  /** How much of its own colour a tinted badge keeps; the rest is text colour (contrast). */
  "tone-ink": "65%",
} as const satisfies ThemeTokens;

const s = palette.stone;

export const light = {
  ...derived,
  bg: s[50],
  panel: s[0],
  nav: s[150],
  surface: s[0],
  "surface-raised": s[75],
  "surface-sunken": s[100],
  field: s[100],
  border: s[200],
  text: s[900],
  "text-muted": s[600],
  accent: accentPresets[DEFAULT_ACCENT].light,
  "on-accent": s[0],
  "on-danger": s[0],
  success: palette.sage[700],
  danger: palette.brick[700],
  warning: palette.ochre[700],
  info: palette.steel[700],
  backdrop: "rgb(31 35 40 / 0.4)",
  "shadow-1": "0 1px 2px rgb(31 35 40 / 0.12)",
  "shadow-2": "0 8px 24px rgb(31 35 40 / 0.16)",
  "shadow-3": "0 20px 60px rgb(31 35 40 / 0.24)",
  "shadow-dock": "0 -8px 24px rgb(31 35 40 / 0.14)",
  // Domain colours are tuned for dark pages: on light they need more ink.
  "tone-ink": "35%",
} as const satisfies ThemeTokens;

/**
 * Resolved themes; adding one here is the whole change: CSS, the pre-paint
 * script and the Settings choice follow.
 */
export const themes = { dark, light } as const satisfies Record<string, ThemeTokens>;
export type ThemeName = keyof typeof themes;

const hd = palette.highDark;
const hl = palette.highLight;

/** High contrast: 7:1 for text, borders that read as edges, no tinted surfaces. */
export const highContrastThemes = {
  dark: {
    ...derived,
    "border-strong": hd.text,
    bg: hd.bg,
    panel: hd.surface,
    nav: hd.bg,
    surface: hd.surface,
    "surface-raised": hd.raised,
    "surface-sunken": hd.bg,
    field: hd.bg,
    border: hd.border,
    text: hd.text,
    "text-muted": hd.muted,
    accent: hd.blue,
    "on-accent": "#000000",
    "on-danger": "#000000",
    success: hd.green,
    danger: hd.red,
    warning: hd.amber,
    info: hd.blueText,
    backdrop: "rgb(0 0 0 / 0.8)",
    "shadow-1": "none",
    "shadow-2": "0 0 0 1px #ffffff",
    "shadow-3": "0 0 0 2px #ffffff",
    "shadow-dock": "none",
    "tone-ink": "40%",
  },
  light: {
    ...derived,
    "border-strong": hl.text,
    bg: hl.bg,
    panel: hl.bg,
    nav: hl.sunken,
    surface: hl.bg,
    "surface-raised": hl.bg,
    "surface-sunken": hl.sunken,
    field: hl.bg,
    border: hl.border,
    text: hl.text,
    "text-muted": hl.muted,
    accent: hl.blue,
    "on-accent": "#ffffff",
    "on-danger": "#ffffff",
    success: hl.green,
    danger: hl.red,
    warning: hl.amber,
    info: hl.blueText,
    backdrop: "rgb(0 0 0 / 0.6)",
    "shadow-1": "none",
    "shadow-2": "0 0 0 1px #0e1116",
    "shadow-3": "0 0 0 2px #0e1116",
    "shadow-dock": "none",
    "tone-ink": "20%",
  },
} as const satisfies Record<ThemeName, ThemeTokens>;

/** Status roles the colour-blind palette replaces. */
export type CvdTokens = Readonly<Pick<ThemeTokens, "success" | "danger" | "warning" | "info">>;

const cvdDark = {
  success: palette.cvd.blue,
  danger: palette.cvd.orange,
  warning: palette.cvd.yellow,
  info: palette.cvd.purple,
} as const satisfies CvdTokens;

/**
 * data-cvd="on": blue/orange instead of green/red, per resolved theme. Every
 * theme needs one, so a new theme cannot forget it.
 */
export const cvdThemes = {
  dark: cvdDark,
  light: { success: palette.cvdLight.blue, danger: palette.cvdLight.orange, warning: palette.cvdLight.yellow, info: palette.cvdLight.purple },
} as const satisfies Record<ThemeName, CvdTokens>;

/** The colour-blind palette on top of high contrast, again 7:1. */
export const cvdHighContrastThemes = {
  dark: {
    success: palette.cvdHighDark.blue,
    danger: palette.cvdHighDark.orange,
    warning: palette.cvdHighDark.yellow,
    info: palette.cvdHighDark.purple,
  },
  light: {
    success: palette.cvdHighLight.blue,
    danger: palette.cvdHighLight.orange,
    warning: palette.cvdHighLight.yellow,
    info: palette.cvdHighLight.purple,
  },
} as const satisfies Record<ThemeName, CvdTokens>;

/** Foreground/background pairs that must meet WCAG contrast. */
export const contrastPairs: ReadonlyArray<{
  fg: SemanticToken;
  bg: SemanticToken;
  min: number;
  why: string;
}> = [
  { fg: "text", bg: "bg", min: 4.5, why: "body text" },
  { fg: "text", bg: "surface", min: 4.5, why: "body text on cards" },
  { fg: "text", bg: "surface-raised", min: 4.5, why: "text in popovers" },
  { fg: "text-muted", bg: "bg", min: 4.5, why: "secondary text" },
  { fg: "text-muted", bg: "surface", min: 4.5, why: "secondary text on cards" },
  { fg: "text", bg: "panel", min: 4.5, why: "text in the window chrome" },
  { fg: "text", bg: "nav", min: 4.5, why: "navigation labels" },
  { fg: "text", bg: "field", min: 4.5, why: "input text" },
  { fg: "text-muted", bg: "panel", min: 4.5, why: "secondary text in the window chrome" },
  { fg: "text-muted", bg: "nav", min: 4.5, why: "inactive navigation labels" },
  { fg: "text-muted", bg: "field", min: 4.5, why: "secondary text in inputs" },
  { fg: "text-muted", bg: "surface-raised", min: 4.5, why: "secondary text in popovers" },
  { fg: "on-accent", bg: "accent", min: 4.5, why: "primary button label" },
  { fg: "on-danger", bg: "danger", min: 4.5, why: "danger button label" },
  { fg: "accent", bg: "surface", min: 4.5, why: "links and accent text" },
  { fg: "accent", bg: "panel", min: 4.5, why: "accent text in the window chrome" },
  { fg: "accent", bg: "nav", min: 4.5, why: "the active navigation item" },
  { fg: "danger", bg: "surface", min: 4.5, why: "error text" },
  { fg: "danger", bg: "surface-raised", min: 4.5, why: "error text in dialogs" },
  { fg: "success", bg: "surface", min: 4.5, why: "success text" },
  { fg: "warning", bg: "surface", min: 4.5, why: "warning text" },
  { fg: "info", bg: "surface", min: 4.5, why: "info text" },
  { fg: "focus-ring", bg: "bg", min: 3, why: "focus indicator (WCAG 1.4.11)" },
  { fg: "focus-ring", bg: "surface", min: 3, why: "focus indicator on cards" },
  { fg: "focus-ring", bg: "field", min: 3, why: "focus indicator in inputs" },
];

/** Theme-independent tokens. */
export const staticTokens = {
  "z-sticky": "10",
  "z-popover": "100",
  "z-toast": "300",
} as const;

/** Density only moves control heights, cell padding and list text. */
export const densities = {
  compact: {
    "control-sm": "20px",
    "control-md": "28px",
    "control-lg": "36px",
    "cell-y": "4px",
    "cell-x": "6px",
    "font-size-list": "11px",
  },
  normal: {
    "control-sm": "24px",
    "control-md": "32px",
    "control-lg": "40px",
    "cell-y": "6px",
    "cell-x": "8px",
    "font-size-list": "12px",
  },
  comfortable: {
    "control-sm": "28px",
    "control-md": "36px",
    "control-lg": "44px",
    "cell-y": "8px",
    "cell-x": "10px",
    "font-size-list": "13px",
  },
} as const satisfies Record<string, Record<string, string>>;

export type DensityName = keyof typeof densities;
export const DEFAULT_THEME: ThemeName = "dark";
export const DEFAULT_DENSITY: DensityName = "normal";
