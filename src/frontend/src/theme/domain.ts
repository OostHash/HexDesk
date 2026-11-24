/**
 * Layer 3: domain colours (rarity, relics, timers, syndicates, ...).
 * Not UI roles: never used for chrome, only passed to a primitive as
 * --hex-tone. Not exposed as Tailwind colours. The values are the same in
 * dark and light; the colour-blind palette below replaces some of them.
 */
export const domainColors = {
  "rarity-bronze": "#cd7f32",
  "rarity-silver": "#c0c0c0",
  "rarity-gold": "#f0c040",
  ducat: "#f0c040",
  "relic-highlight": "#88b8ff",

  "state-cool": "#6eb6ff",
  "state-warm": "#ff8c5a",
  "state-fass": "#ff6b4a",
  "state-void": "#c084fc",
  "state-anger": "#f87171",
  "state-envy": "#4ade80",
  "state-sorrow": "#60a5fa",
  "state-day": "#f0c040",
  "state-joy": "#f0c040",

  "tier-lith": "#c8853a",
  "tier-meso": "#a8a9ad",
  "tier-neo": "#f0c040",
  "tier-axi": "#e5c04a",
  "tier-requiem": "#9b6dff",
  "tier-omnia": "#e0e0e0",

  "news-prime": "#e6af32",
  "news-stream": "#a47bff",
  "news-update": "#4ea8f0",

  "price-platinum": "#b39ddb",
  "direct-trade": "#a371f7",
  vaulted: "#ff6b6b",
  mastered: "#4ecdc4",
  mastery: "#c0a060",
  owned: "#5dbf7a",
  kuva: "#9d6cff",
  archon: "#b48cff",

  "mod-arcane": "#bc8cff",
  "mod-standard": "#6ea8fe",

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
  owned: "#56b4e9",
  vaulted: "#e69f00",
} as const satisfies Partial<Record<DomainColor, string>>;
