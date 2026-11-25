import { palette } from "./palette.ts";

/**
 * Layer 3: domain colours (rarity, relics, timers, syndicates, ...).
 * Not UI roles: never used for chrome, only passed to a primitive as
 * --hex-tone. Not exposed as Tailwind colours. The values are the same in
 * dark and light; the colour-blind palette below replaces some of them.
 * Aliases that mean the same kind of thing share a palette step; identity
 * colours (syndicates, platinum, mastery, timer states) keep their own value.
 */
export const domainColors = {
  "rarity-bronze": palette.bronze[500],
  "rarity-silver": palette.silver[400],
  "rarity-gold": palette.gold[400],
  "rarity-legendary": "#e5e4e2",
  ducat: palette.gold[400],
  "relic-highlight": palette.sky[300],

  "state-cool": palette.sky[400],
  "state-warm": "#ff8c5a",
  "state-fass": "#ff6b4a",
  "state-void": palette.violet[300],
  "state-anger": "#f87171",
  "state-envy": "#4ade80",
  "state-sorrow": palette.sky[500],
  "state-day": palette.gold[400],
  "state-joy": palette.gold[400],

  "tier-lith": palette.bronze[500],
  "tier-meso": palette.silver[400],
  "tier-neo": palette.gold[400],
  "tier-axi": palette.gold[200],
  "tier-requiem": palette.violet[600],
  "tier-omnia": "#e0e0e0",

  "news-prime": palette.gold[500],
  "news-stream": palette.violet[500],
  "news-update": palette.sky[500],

  "price-platinum": "#b39ddb",
  "direct-trade": palette.violet[500],
  vaulted: "#ff6b6b",
  mastered: "#4ecdc4",
  mastery: "#c0a060",
  owned: "#5dbf7a",
  kuva: palette.violet[600],
  archon: palette.violet[400],

  "mod-arcane": palette.violet[400],
  "mod-standard": palette.sky[400],

  "syndicate-steel-meridian": "#c43434",
  "syndicate-arbiters-of-hexis": "#d4a017",
  "syndicate-cephalon-suda": "#00b5cc",
  "syndicate-the-perrin-sequence": "#3cb371",
  "syndicate-red-veil": "#9e1515",
  "syndicate-new-loka": "#6dbf67",
  "syndicate-ostron": "#d4890a",
  "syndicate-solaris-united": "#4fc3f7",
  "syndicate-entrati": "#9b59b6",
  "syndicate-necraloid": "#6c3483",
  "syndicate-the-holdfasts": "#f39c12",
  "syndicate-kahl-s-garrison": "#7f8c8d",
  "syndicate-cavia": "#e91e8c",
  "syndicate-bio-lab": "#66bb6a",
  "syndicate-chem-lab": "#ffa726",
  "syndicate-energy-lab": "#42a5f5",
  "syndicate-tenno-lab": "#ab47bc",
  "syndicate-orokin-lab": "#c8a951",
  "syndicate-ventkids-bash-lab": "#8d6e63",
  "syndicate-dry-docks": "#78909c",
  "syndicate-dagath-s-hollow": "#7e57c2",
  "syndicate-the-quills": "#ecf0f1",
  "syndicate-vox-solaris": "#26a69a",
  "syndicate-ventkids": "#e74c3c",
  "syndicate-cephalon-simaris": "#e67e22",
  "syndicate-conclave": "#c0392b",
  "syndicate-operational-supply": "#607d8b",
} as const satisfies Record<string, string>;

export type DomainColor = keyof typeof domainColors;

/**
 * data-cvd="on": domain colours whose meaning rests on green versus red
 * (owned versus vaulted) move to blue/orange.
 */
export const cvdDomainColors = {
  owned: palette.cvd.blue,
  vaulted: palette.cvd.orange,
} as const satisfies Partial<Record<DomainColor, string>>;
