/**
 * Layer 1: raw colour values. Only tokens.ts reads this file; components never
 * do. Values change where contrast or consistency asks for it.
 */
export const palette = {
  neutral: {
    950: "#0d1117",
    900: "#161b22",
    850: "#1a1f2a",
    700: "#30363d",
    500: "#6e7681",
    400: "#8b949e",
    100: "#e6edf3",
  },
  blue: { 500: "#388bfd", 400: "#58a6ff" },
  green: { 500: "#3fb950" },
  red: { 500: "#f85149" },
  amber: { 500: "#d29922" },
  ink: { onAccent: "#1e1e2e" },
  /** Okabe-Ito: stays apart under deuteranopia and protanopia (colour-blind palette). */
  cvd: { blue: "#56b4e9", orange: "#e69f00", yellow: "#f0e442", purple: "#cc79a7" },

  /** Light theme (fase 7B): the same hues, darkened for a white page. */
  light: {
    bg: "#f6f8fa",
    surface: "#ffffff",
    sunken: "#eaeef2",
    border: "#d0d7de",
    text: "#1f2328",
    muted: "#59636e",
    blue: "#0969da",
    blueText: "#0550ae",
    green: "#1a7f37",
    red: "#cf222e",
    amber: "#9a6700",
  },
  cvdLight: { blue: "#0072b2", orange: "#b35000", yellow: "#7a6200", purple: "#a3417e" },

  /** High contrast (7:1 for text): near-black or white pages, strong borders. */
  highDark: {
    bg: "#000000",
    surface: "#0a0c10",
    raised: "#14171c",
    border: "#7d8590",
    text: "#ffffff",
    muted: "#d1d7e0",
    blue: "#71b7ff",
    blueText: "#a5d6ff",
    green: "#56d364",
    red: "#ff9492",
    amber: "#f0b72f",
  },
  cvdHighDark: { blue: "#7cc8f0", orange: "#ffb340", yellow: "#f5ec7a", purple: "#e7a3cb" },
  highLight: {
    bg: "#ffffff",
    sunken: "#e8ebef",
    border: "#20252c",
    text: "#0e1116",
    muted: "#2e353e",
    blue: "#023b95",
    blueText: "#03348a",
    green: "#024c1a",
    red: "#86061d",
    amber: "#5c3b00",
  },
  cvdHighLight: { blue: "#004d7a", orange: "#7a3300", yellow: "#4d4000", purple: "#6b1f50" },
} as const;
