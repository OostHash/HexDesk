/** Relic pick overlay rules. Pure functions. */

export type PickReward = { name: string; rarity: string; drop_rate: number; ducats: number; plat: number; vaulted: boolean; owned: boolean };
export type PickRelic = {
  name: string;
  base_name: string;
  refinement: string;
  count: number;
  /** Whether the relic list on screen showed it; null or missing when unknown. */
  on_screen?: boolean | null;
  unowned_score: number;
  ducat_score: number;
  plat_score: number;
  rewards: PickReward[];
};
/** `view` numbers what the backend sent, so the window can confirm drawing it. */
export type RelicPick = { era: string; relics: PickRelic[]; view?: number };

export const PICK_PRIORITIES = ["unowned", "ducat", "platinum"] as const;
export type PickPriority = (typeof PICK_PRIORITIES)[number];
export const PICK_LINES = ["all", "best", "estimated"] as const;
export type PickLines = (typeof PICK_LINES)[number];

export const pickPriorityFrom = (v: unknown): PickPriority => ((PICK_PRIORITIES as readonly unknown[]).includes(v) ? (v as PickPriority) : "unowned");
export const pickLinesFrom = (v: unknown): PickLines => ((PICK_LINES as readonly unknown[]).includes(v) ? (v as PickLines) : "all");

export const PICK_PRIORITY_LABEL: Readonly<Record<PickPriority, string>> = {
  unowned: "Unowned / mastery",
  ducat: "Most ducats (EV)",
  platinum: "Most platinum (EV)",
};
export const PICK_LINES_LABEL: Readonly<Record<PickLines, string>> = {
  all: "All rewards",
  best: "Best reward",
  estimated: "Estimated value",
};

const ERA_LABEL: Readonly<Record<string, string>> = { LITH: "Lith", MESO: "Meso", NEO: "Neo", AXI: "Axi", ALL: "All Eras" };
export const eraLabel = (era: string) => ERA_LABEL[era] ?? era;

export function pickScore(relic: PickRelic, priority: PickPriority): number {
  if (priority === "platinum") return relic.plat_score;
  if (priority === "ducat") return relic.ducat_score;
  return relic.unowned_score;
}

/**
 * The score a relic is ranked by, as a headline number and what it means:
 * "38%" chance of something new, or the average platinum or ducats per run.
 */
export function scoreHeadline(relic: PickRelic, priority: PickPriority): { value: string; caption: string } {
  const s = pickScore(relic, priority);
  if (priority === "platinum") return { value: `${s.toFixed(0)}p`, caption: "platinum per run, on average" };
  if (priority === "ducat") return { value: s.toFixed(0), caption: "ducats per run, on average" };
  return { value: `${(s * 100).toFixed(0)}%`, caption: "chance of something new" };
}

/** The three best confirmed relics for the priority. Never recommend a relic
 * that a complete on-screen list did not confirm. */
export const topRelics = (pick: RelicPick, priority: PickPriority): PickRelic[] =>
  [...pick.relics]
    .filter((relic) => relic.on_screen !== false)
    .sort((a, b) => pickScore(b, priority) - pickScore(a, priority))
    .slice(0, 3);

const RARITY_ORDER: Readonly<Record<string, number>> = { Gold: 0, Silver: 1, Bronze: 2 };

/** Which rewards a relic lists: all by rarity, or only the best for the priority. */
export function shownRewards(relic: PickRelic, lines: PickLines, priority: PickPriority): PickReward[] {
  if (lines !== "best") return [...relic.rewards].sort((a, b) => (RARITY_ORDER[a.rarity] ?? 3) - (RARITY_ORDER[b.rarity] ?? 3));
  if (priority === "platinum") return [...relic.rewards].sort((a, b) => b.plat - a.plat).slice(0, 1);
  if (priority === "ducat") return [...relic.rewards].sort((a, b) => b.ducats - a.ducats).slice(0, 1);
  return relic.rewards.filter((r) => !r.owned).sort((a, b) => b.drop_rate - a.drop_rate);
}

/** The in-game word for a reward's rarity tier. */
const RARITY_LABEL: Readonly<Record<string, string>> = { Gold: "Rare", Silver: "Uncommon", Bronze: "Common" };
export const rarityLabel = (rarity: string) => RARITY_LABEL[rarity] ?? rarity;

/** A drop chance as a percentage: whole numbers, one decimal below 10%. */
export function dropChance(rate: number): string {
  const pct = rate * 100;
  return `${pct < 10 ? String(Math.round(pct * 10) / 10) : pct.toFixed(0)}%`;
}

export const refinementLabel = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);

/** The example for Settings → Overlays → Show. */
export const PREVIEW_PICK: RelicPick = {
  era: "ALL",
  relics: [
    {
      name: "Axi R4 Intact",
      base_name: "Axi R4",
      refinement: "intact",
      count: 1,
      unowned_score: 0.3833,
      ducat_score: 19.5,
      plat_score: 5.4,
      rewards: [
        { name: "Forma Blueprint", rarity: "Bronze", drop_rate: 0.2533, ducats: 0, plat: 0, vaulted: false, owned: true },
        { name: "Boltor Prime Stock", rarity: "Bronze", drop_rate: 0.2533, ducats: 15, plat: 9, vaulted: true, owned: true },
        { name: "Burston Prime Blueprint", rarity: "Bronze", drop_rate: 0.2533, ducats: 15, plat: 3, vaulted: true, owned: false },
        { name: "Glaive Prime Disc", rarity: "Silver", drop_rate: 0.11, ducats: 45, plat: 9, vaulted: true, owned: false },
        { name: "Ember Prime Systems Blueprint", rarity: "Silver", drop_rate: 0.11, ducats: 45, plat: 9, vaulted: true, owned: true },
        { name: "Rhino Prime Blueprint", rarity: "Gold", drop_rate: 0.02, ducats: 100, plat: 20, vaulted: true, owned: false },
      ],
    },
    {
      name: "Meso N1 Intact",
      base_name: "Meso N1",
      refinement: "intact",
      count: 2,
      unowned_score: 0.2733,
      ducat_score: 26,
      plat_score: 2.4,
      rewards: [
        { name: "Fang Prime Handle", rarity: "Bronze", drop_rate: 0.2533, ducats: 25, plat: 2, vaulted: true, owned: false },
        { name: "Braton Prime Stock", rarity: "Bronze", drop_rate: 0.2533, ducats: 25, plat: 1, vaulted: true, owned: true },
        { name: "Fang Prime Blueprint", rarity: "Bronze", drop_rate: 0.2533, ducats: 25, plat: 1, vaulted: true, owned: true },
        { name: "2X Forma Blueprint", rarity: "Silver", drop_rate: 0.11, ducats: 0, plat: 0, vaulted: false, owned: true },
        { name: "Dual Kamas Prime Handle", rarity: "Silver", drop_rate: 0.11, ducats: 45, plat: 7, vaulted: true, owned: true },
        { name: "Nyx Prime Neuroptics Blueprint", rarity: "Gold", drop_rate: 0.02, ducats: 100, plat: 30, vaulted: true, owned: false },
      ],
    },
    {
      name: "Lith S1 Intact",
      base_name: "Lith S1",
      refinement: "intact",
      count: 3,
      unowned_score: 0.13,
      ducat_score: 18.4,
      plat_score: 3.3,
      rewards: [
        { name: "Paris Prime String", rarity: "Bronze", drop_rate: 0.2533, ducats: 15, plat: 2, vaulted: false, owned: true },
        { name: "Hikou Prime Blueprint", rarity: "Bronze", drop_rate: 0.2533, ducats: 15, plat: 4, vaulted: true, owned: true },
        { name: "Bronco Prime Blueprint", rarity: "Bronze", drop_rate: 0.2533, ducats: 15, plat: 3, vaulted: true, owned: true },
        { name: "Paris Prime Grip", rarity: "Silver", drop_rate: 0.11, ducats: 45, plat: 3, vaulted: false, owned: false },
        { name: "2X Forma Blueprint", rarity: "Silver", drop_rate: 0.11, ducats: 0, plat: 0, vaulted: false, owned: true },
        { name: "Spira Prime Pouch", rarity: "Gold", drop_rate: 0.02, ducats: 100, plat: 35, vaulted: true, owned: false },
      ],
    },
  ],
};

/** One line saying what the overlay shows, for the backend log. */
export const pickSummary = (pick: RelicPick, priority: PickPriority): string => {
  const relics = topRelics(pick, priority);
  const listed = relics.map((r) => `${r.base_name} ${r.refinement} x${String(r.count)}`).join(", ");
  return `${pick.era}: ${relics.length === 0 ? "no relics" : listed}`;
};
