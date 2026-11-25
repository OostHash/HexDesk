/**
 * Layer 1: raw colour values. Only tokens.ts and domain.ts read this file;
 * components never do. Values change where contrast or consistency asks for it.
 */
export const palette = {
  /** Dark neutrals: graphite surfaces with warm off-white text. */
  graphite: {
    1000: "#14171b",
    950: "#17191c",
    925: "#171a1e",
    900: "#1d2024",
    800: "#25282c",
    750: "#292d32",
    700: "#373b41",
    400: "#a0a5ab",
    100: "#e8e5df",
  },
  /** Light neutrals: warm stone, not an inverted dark theme. */
  stone: {
    0: "#ffffff",
    50: "#f5f4f0",
    75: "#f0efeb",
    100: "#efeee9",
    150: "#e9e7e1",
    200: "#dad7d0",
    600: "#5c636a",
    900: "#252a2f",
  },

  /**
   * UI hues. 400 is the step for dark pages, 700 for light pages; both reach
   * 4.5:1 as text on every surface of their theme.
   */
  amber: { 400: "#c1874a", 700: "#8f5c27" },
  /** Warning sits towards yellow so it never reads as the amber accent. */
  ochre: { 400: "#d2b04c", 700: "#736a00" },
  sage: { 400: "#7fae86", 700: "#357544" },
  brick: { 400: "#d0807a", 700: "#ae4c4b" },
  steel: { 400: "#7fa6cc", 700: "#3d6a94" },
  /** Accent presets besides amber (Settings → Appearance), muted so they stay apart from domain colours. */
  teal: { 400: "#5fa8a0", 700: "#2f6f69" },
  iris: { 400: "#a68fd6", 700: "#6a55a8" },
  rose: { 400: "#d08aa6", 700: "#9c4a6b" },
  azure: { 400: "#7d9fd9", 700: "#3f63a6" },

  /** Domain hues, shared by aliases in domain.ts that mean the same kind of thing. */
  bronze: { 500: "#cd7f32" },
  silver: { 400: "#b8b9bd" },
  gold: { 200: "#ecd9a0", 400: "#f0c040", 500: "#e6af32" },
  violet: { 300: "#c084fc", 400: "#b88cff", 500: "#a47bff", 600: "#9d6cff" },
  sky: { 300: "#88b8ff", 400: "#6eb2ff", 500: "#58a6f8" },

  /** Okabe-Ito: stays apart under deuteranopia and protanopia (colour-blind palette). */
  cvd: { blue: "#56b4e9", orange: "#e69f00", yellow: "#f0e442", purple: "#cc79a7" },
  cvdLight: { blue: "#0072b2", orange: "#b04f00", yellow: "#7a6200", purple: "#a3417e" },

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
