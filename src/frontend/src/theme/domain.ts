/**
 * Layer 3: domain colours (rarity, relics, syndicates, transactions, ...).
 * Not UI roles: never used for chrome, only passed to a primitive as
 * --ff-tone. Not exposed as Tailwind colours. The values are the same in
 * dark and light; the colour-blind palette below replaces some of them.
 */
export const domainColors = {
  "rarity-bronze": "#cd7f32",
  "rarity-silver": "#c0c0c0",
  "rarity-gold": "#f0c040",
  ducat: "#f0c040",

  "relic-bronze": "#e8923a",
  "relic-highlight": "#88b8ff",
  "reward-name": "#f0e0a0",
  "reward-bronze": "#c47d3a",
  "reward-silver": "#9ba8b5",
  "refinement-exceptional": "#79c0ff",
  "refinement-flawless": "#a371f7",
  "refinement-radiant": "#d4a847",

  "state-cool": "#6eb6ff",
  "state-warm": "#ff8c5a",
  "state-fass": "#ff6b4a",
  "state-void": "#c084fc",
  "state-anger": "#f87171",
  "state-envy": "#4ade80",
  "state-sorrow": "#60a5fa",

  "tier-lith": "#c8853a",
  "tier-meso": "#a8a9ad",
  "tier-neo": "#f0c040",
  "tier-axi": "#e5c04a",
  "tier-requiem": "#9b6dff",
  "tier-omnia": "#e0e0e0",

  "news-prime": "#e6af32",
  "news-stream": "#a47bff",
  "news-update": "#4ea8f0",

  "txn-sale": "#27ae60",
  "txn-purchase": "#e74c3c",
  "txn-trade": "#3498db",

  "price-platinum": "#b39ddb",
  "set-price": "#c8a8ff",
  "direct-trade": "#a371f7",
  vaulted: "#ff6b6b",
  mastered: "#4ecdc4",
  mastery: "#c0a060",
  owned: "#5dbf7a",
  kuva: "#9d6cff",
  archon: "#b48cff",

  "mod-arcane": "#bc8cff",
  "mod-chip": "#d4a843",
  "riven-card": "#b49650",
  "riven-buff": "#2ea043",

  "wiki-link": "#6ea8fe",
  "wiki-link-hover": "#a8c8ff",

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

  "brand-discord": "#5865f2",
  "brand-kofi": "#ff5e5b",
} as const satisfies Record<string, string>;

export type DomainColor = keyof typeof domainColors;

/**
 * data-cvd="on": domain colours whose meaning rests on green versus red
 * (gain/loss, owned/vaulted) move to blue/orange.
 */
export const cvdDomainColors = {
  "txn-sale": "#56b4e9",
  owned: "#56b4e9",
  "riven-buff": "#56b4e9",
  "txn-purchase": "#e69f00",
  vaulted: "#e69f00",
} as const satisfies Partial<Record<DomainColor, string>>;
