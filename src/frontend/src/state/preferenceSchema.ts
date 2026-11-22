import { DEFAULT_DENSITY, DEFAULT_THEME, densities, highContrastThemes, themes, type DensityName, type ThemeName } from "../theme/tokens";

/**
 * UI preferences: theme, contrast, colour-blind palette, density
 * and text scale.
 * Source of truth is localStorage, so index.html can apply them before the
 * first paint. Some keys are older than HexDesk (ff-colorblind, ff-text-scale)
 * and are kept, so a saved choice survives after
 * the cutover.
 */

export const PREFERENCE_KEYS = {
  theme: "ff-theme",
  contrast: "ff-contrast",
  cvd: "ff-colorblind",
  density: "ff-density",
  textScale: "ff-text-scale",
} as const;

/** The text-size slider range. */
export const TEXT_SCALE_RANGE = { min: 0.8, max: 2, step: 0.1 } as const;

export const THEME_CHOICES = ["system", "dark", "light"] as const;
export const CONTRAST_CHOICES = ["system", "normal", "high"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type ContrastChoice = (typeof CONTRAST_CHOICES)[number];

export type Preferences = {
  theme: ThemeChoice;
  contrast: ContrastChoice;
  cvd: boolean;
  density: DensityName;
  textScale: number;
};

export const DEFAULT_PREFERENCES: Preferences = {
  // Dark until the user decides otherwise: "system" as default would turn the
  // app light for light-mode Windows users.
  theme: "dark",
  contrast: "system",
  cvd: false,
  density: DEFAULT_DENSITY,
  textScale: 1,
};

/** Attributes written to <html>. index.html computes the same before first paint. */
export type RootAttributes = {
  "data-theme": ThemeChoice;
  "data-resolved-theme": ThemeName;
  "data-contrast": ContrastChoice;
  "data-resolved-contrast": "normal" | "high";
  "data-cvd": "on" | "off";
  "data-density": DensityName;
};

export type MediaState = { prefersDark: boolean; prefersMoreContrast: boolean };

export function clampTextScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_PREFERENCES.textScale;
  const stepped = Math.round(value / TEXT_SCALE_RANGE.step) * TEXT_SCALE_RANGE.step;
  return Math.min(TEXT_SCALE_RANGE.max, Math.max(TEXT_SCALE_RANGE.min, Number(stepped.toFixed(2))));
}

const oneOf = <T extends string>(choices: readonly T[], value: string | null, fallback: T): T =>
  value !== null && (choices as readonly string[]).includes(value) ? (value as T) : fallback;

export function parsePreferences(read: (key: string) => string | null): Preferences {
  return {
    theme: oneOf(THEME_CHOICES, read(PREFERENCE_KEYS.theme), DEFAULT_PREFERENCES.theme),
    contrast: oneOf(CONTRAST_CHOICES, read(PREFERENCE_KEYS.contrast), DEFAULT_PREFERENCES.contrast),
    cvd: read(PREFERENCE_KEYS.cvd) === "true",
    density: oneOf(Object.keys(densities) as DensityName[], read(PREFERENCE_KEYS.density), DEFAULT_PREFERENCES.density),
    textScale: clampTextScale(parseFloat(read(PREFERENCE_KEYS.textScale) ?? "")),
  };
}

/**
 * Picks the theme that is actually rendered. A choice whose token set does
 * not exist falls back to the default theme.
 */
export function resolveAttributes(prefs: Preferences, media: MediaState): RootAttributes {
  const wanted = prefs.theme === "system" ? (media.prefersDark ? "dark" : "light") : prefs.theme;
  const resolvedTheme: ThemeName = Object.hasOwn(themes, wanted) ? wanted : DEFAULT_THEME;
  const resolvedContrast = prefs.contrast === "system" ? (media.prefersMoreContrast ? "high" : "normal") : prefs.contrast;
  return {
    "data-theme": prefs.theme,
    "data-resolved-theme": resolvedTheme,
    "data-contrast": prefs.contrast,
    "data-resolved-contrast": resolvedContrast,
    "data-cvd": prefs.cvd ? "on" : "off",
    "data-density": prefs.density,
  };
}

/**
 * The theme and contrast choices that do something with the token sets that
 * exist. "system" needs both sides; a list of one is
 * no choice, so Settings hides it.
 */
export function availableChoices(
  themeNames: readonly string[] = Object.keys(themes),
  highContrast: readonly string[] = Object.keys(highContrastThemes),
): { themes: ThemeChoice[]; contrasts: ContrastChoice[] } {
  const hasTheme = (name: string) => themeNames.includes(name);
  const themeList = THEME_CHOICES.filter((c) => (c === "system" ? hasTheme("dark") && hasTheme("light") : hasTheme(c)));
  const allHigh = themeNames.length > 0 && themeNames.every((name) => highContrast.includes(name));
  const contrastList = CONTRAST_CHOICES.filter((c) => c === "normal" || allHigh);
  return { themes: themeList, contrasts: contrastList };
}

export const THEME_LABEL: Readonly<Record<ThemeChoice, string>> = { system: "System", dark: "Dark", light: "Light" };
export const CONTRAST_LABEL: Readonly<Record<ContrastChoice, string>> = { system: "System", normal: "Normal", high: "High" };
export const DENSITY_LABEL: Readonly<Record<DensityName, string>> = { compact: "Compact", normal: "Normal", comfortable: "Comfortable" };
export const DENSITY_CHOICES = Object.keys(densities) as DensityName[];
export type { DensityName };
