import type { OwnedRiven, RivenAnalysis, SavedRiven } from "../../domain/rivens";
import type { Fixture } from "./scenario";

/**
 * Rivens: a small weapon database, a deterministic analyzer, saved rolls in
 * memory, and owned rivens of every kind (two unveiled with stats, one
 * revealed with a challenge, unrevealed ×3). Soma and Lato exist in the
 * inventory catalogue, so their names resolve.
 */
const WEAPONS = ["soma", "soma prime", "braton", "braton prime", "lato", "kronen prime", "ignis wraith", "rubico prime", "nikana prime"];
const WANTED: Readonly<Record<string, readonly string[]>> = {
  soma: ["Critical Damage", "Critical Chance", "Multishot"],
  "soma prime": ["Critical Damage", "Critical Chance", "Multishot"],
  "rubico prime": ["Critical Damage", "Multishot", "Base Damage"],
};
const HARMFUL = new Set(["Critical Damage", "Critical Chance", "Multishot", "Base Damage", "Fire Rate"]);

function analyze({ weapon, positives, negatives }: { weapon: string; positives: string[]; negatives: string[] }): RivenAnalysis {
  const wanted = WANTED[weapon] ?? ["Critical Chance", "Base Damage", "Status Chance"];
  const alt = (label: string, list: readonly string[]) => {
    const matched = list.filter((w) => positives.includes(w));
    const score = Math.min(1, matched.length / list.length - (negatives.some((n) => HARMFUL.has(n)) ? 0.25 : 0));
    const verdict = score >= 0.8 ? "GREAT — sell it" : score >= 0.6 ? "GOOD — usable" : score >= 0.3 ? "MEDIOCRE — reroll" : "BAD — reroll";
    return { label, matched, missing: list.filter((w) => !positives.includes(w)), score: Math.max(0, score), verdict };
  };
  const alternatives =
    weapon.includes("prime") || weapon === "soma"
      ? [alt("Crit build", wanted), alt("Status build", ["Status Chance", "Multishot", "Toxicity"])]
      : [alt("Build", wanted)];
  const first = alternatives[0] ?? alt("Build", wanted);
  return {
    weapon,
    safe_negatives_present: negatives.filter((n) => !HARMFUL.has(n)),
    harmful_negatives: negatives.filter((n) => HARMFUL.has(n)),
    score: first.score,
    verdict: first.verdict,
    notes: negatives.length === 0 ? "A negative stat you do not use makes a roll better." : "",
    alternatives,
  };
}

const initialSaved = (): SavedRiven[] => [
  {
    id: "r1",
    weapon: "soma",
    label: "Soma · 2 Nov 2026",
    stats_json: JSON.stringify([
      { name: "Critical Damage", value: "112", positive: true },
      { name: "Multishot", value: "88", positive: true },
      { name: "Zoom", value: "-34", positive: false },
    ]),
    verdict: "GREAT — sell it",
    score: 0.92,
    saved_at: "2026-11-02T18:00:00Z",
  },
  {
    id: "r2",
    weapon: "soma",
    label: "Soma · 5 Nov 2026",
    stats_json: JSON.stringify([
      { name: "Critical Chance", value: "130", positive: true },
      { name: "Heat", value: "60", positive: true },
      { name: "Fire Rate", value: "-20", positive: false },
    ]),
    verdict: "MEDIOCRE — reroll",
    score: 0.42,
    saved_at: "2026-11-05T20:00:00Z",
  },
];

let saved = initialSaved();
let seq = 3;

export function resetMockRivens() {
  saved = initialSaved();
  seq = 3;
}

const MAX = 0x3fffffff;
export const OWNED_RIVENS: OwnedRiven[] = [
  {
    item_id: "riv1",
    item_type: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
    mod_name: "",
    riven_state: "unlocked",
    compat: "/Weapons/Soma",
    challenge_type: null,
    challenge_complication: null,
    lvl_req: 12,
    polarity: "AP_ATTACK",
    buffs: [
      { tag: "WeaponCritDamageMod", value: Math.round(MAX * 0.8) },
      { tag: "WeaponFireIterationsMod", value: Math.round(MAX * 0.6) },
    ],
    curses: [{ tag: "WeaponZoomFovMod", value: Math.round(MAX * 0.4) }],
    mod_rank: 8,
    count: 1,
    rerolls: 14,
  },
  {
    item_id: "riv2",
    item_type: "/Lotus/Upgrades/Mods/Randomized/LotusPistolRandomModRare",
    mod_name: "visi-crita-tis",
    riven_state: "unlocked",
    compat: "/Weapons/Lato",
    challenge_type: null,
    challenge_complication: null,
    lvl_req: 9,
    polarity: "AP_TACTIC",
    buffs: [
      { tag: "WeaponDamageAmountMod", value: Math.round(MAX * 0.9) },
      { tag: "WeaponCritChanceMod", value: Math.round(MAX * 0.5) },
      { tag: "WeaponFactionDamageGrineer", value: Math.round(MAX * 0.3) },
    ],
    curses: [],
    mod_rank: 8,
    count: 1,
    rerolls: 0,
  },
  {
    item_id: "riv3",
    item_type: "/Lotus/Upgrades/Mods/Randomized/LotusMeleeRandomModRare",
    mod_name: "",
    riven_state: "revealed",
    compat: null,
    challenge_type: "/Lotus/Types/Challenges/RandomizedHeadshot",
    challenge_complication: "/Lotus/Types/Challenges/Complications/Sliding",
    lvl_req: null,
    polarity: null,
    buffs: [],
    curses: [],
    mod_rank: 0,
    count: 1,
    rerolls: 0,
  },
  {
    item_id: "",
    item_type: "/Lotus/Upgrades/Mods/Randomized/LotusShotgunRandomModRare",
    mod_name: "",
    riven_state: "unrevealed",
    compat: null,
    challenge_type: null,
    challenge_complication: null,
    lvl_req: null,
    polarity: null,
    buffs: [],
    curses: [],
    mod_rank: 0,
    count: 3,
    rerolls: 0,
  },
];

export const rivenFixtures = {
  get_riven_weapons: { default: () => WEAPONS, empty: () => [] } satisfies Fixture<string[]>,
  reload_riven_database: { default: () => WEAPONS.length } satisfies Fixture<number>,
  analyze_riven: { alwaysDefault: true, default: analyze } satisfies Fixture<
    RivenAnalysis | null,
    { weapon: string; positives: string[]; negatives: string[] }
  >,
  get_saved_riven_rolls: { default: () => saved, empty: () => [] } satisfies Fixture<SavedRiven[]>,
  save_riven_roll: {
    alwaysDefault: true,
    default: ({ weapon, label, statsJson, verdict, score }) => {
      const id = `r${String(seq++)}`;
      saved = [...saved, { id, weapon, label, stats_json: statsJson, verdict, score, saved_at: "2026-11-12T12:00:00Z" }];
      return id;
    },
  } satisfies Fixture<string, { weapon: string; label: string; statsJson: string; verdict: string; score: number }>,
  delete_saved_riven_roll: {
    alwaysDefault: true,
    default: ({ id }) => {
      saved = saved.filter((r) => r.id !== id);
      return null;
    },
  } satisfies Fixture<null, { id: string }>,
  rename_saved_riven_roll: {
    alwaysDefault: true,
    default: ({ id, label }) => {
      saved = saved.map((r) => (r.id === id ? { ...r, label } : r));
      return null;
    },
  } satisfies Fixture<null, { id: string; label: string }>,
  get_rivens: { default: () => OWNED_RIVENS, empty: () => [] } satisfies Fixture<OwnedRiven[]>,
  get_weapon_dispositions: { default: () => ({ "/Weapons/Soma": 0.65, "/Weapons/Lato": 1.45 }) } satisfies Fixture<Record<string, number>>,
  wfm_create_riven_auction: { alwaysDefault: true, default: () => ({ id: "auction-new" }) } satisfies Fixture<unknown, { params: unknown }>,
};
