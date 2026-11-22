/**
 * Rivens: analyzer helpers and owned rivens.
 *
 * Stat values follow calamity-inc/warframe-riven-info RivenParser.js:
 *   buff  = cap * (1.5 * omega * 10) * 1.25^curses * lerp(0.9, 1.1, raw) * buffAtten[buffs] * (rank + 1)
 *   curse = -cap * (1.5 * omega * 10) * lerp * curseAtten[buffs] * buffAtten[curses] * (rank + 1)
 * Kitgun caps equal Pistol caps; Zaw caps equal Melee caps.
 */

// AG=Archgun  ME=Melee/Zaw  PL=Pistol/Kitgun  RI=Rifle  SG=Shotgun
type RT = "AG" | "ME" | "PL" | "RI" | "SG";
type RS = { label: string; unit: "%" | "x" | "m" | "s" | "n"; caps: Partial<Record<RT, number>> };

const BUFF_ATTEN = [0, 1, 0.66000003, 0.5, 0.40000001, 0.34999999] as const;
const CURSE_ATTEN = [0, 1, 0.33000001, 0.5, 1.25, 1.5] as const;

// AG=Archgun  ME=Melee/Zaw  PL=Pistol/Kitgun  RI=Rifle  SG=Shotgun

const RIVEN_CHALLENGE: Record<string, string> = {
  "/Lotus/Types/Challenges/RandomizedFinisherKill": "Kill X enemies with Finishers",
  "/Lotus/Types/Challenges/RandomizedStyleKill": "Kill X enemies while Sliding",
  "/Lotus/Types/Challenges/RandomizedHeadshot": "Kill X enemies with Headshots",
  "/Lotus/Types/Challenges/RandomizedHeadshotUnawareBallistas": "Kill X unalerted Tusk Ballistas with a Headshot",
  "/Lotus/Types/Challenges/RandomizedLongRangeSniper": "Kill X enemies with Headshots from 75m+",
  "/Lotus/Types/Challenges/RandomizedKillPassengers": "Kill X enemies on a Dropship",
  "/Lotus/Types/Challenges/RandomizedFisherman": "Catch X fish without missing a throw",
  "/Lotus/Types/Challenges/PlainsTimedVariety": "Catch 1 fish, mine 1 gem, kill 1 enemy in 30s",
  "/Lotus/Types/Challenges/HighPerfectDefense": "Defense (lvl 30+) without objective taking damage",
  "/Lotus/Types/Challenges/HighExterminationUndetected": "Extermination (lvl 30+) undetected",
  "/Lotus/Types/Challenges/HighSoloInterceptionHobbled": "Solo Interception (lvl 30+) with Hobbled Key",
  "/Lotus/Types/Challenges/HighSurvivalPacifist": "Survival (lvl 30+) without killing anyone",
  "/Lotus/Types/Challenges/RandomizedSkiffArcher": "Destroy X Dargyns with a bow",
  "/Lotus/Types/Challenges/RandomizedAntiAntiAir": "Destroy X Vruush Turrets in Archwing",
  "/Lotus/Types/Challenges/RandomizedFindCaches": "Find X caches",
  "/Lotus/Types/Challenges/RandomizedFindRareMedallions": "Find X Syndicate Medallions",
  "/Lotus/Types/Challenges/RandomizedHeadshotGlide": "3 headshot kills in a single Aim Glide",
  "/Lotus/Types/Challenges/RandomizedWallClingKillstreak": "Kill X enemies while wall dashing/clinging",
  "/Lotus/Types/Challenges/RandomizedKillSentients": "Kill X Sentients",
  "/Lotus/Types/Challenges/RandomizedKillFallingPilots": "Kill X Dargyn Pilots before they hit the ground",
  "/Lotus/Types/Challenges/RandomizedKill": "Kill X enemies",
  "/Lotus/Types/Challenges/RandomizedFlyingHeadshotSeries": "X consecutive headshots in Archwing (Plains)",
  "/Lotus/Types/Challenges/SustainMeleeComboThree": "Sustain a 6x melee combo for 30 seconds",
  "/Lotus/Types/Challenges/LimitedSynthesis": "Synthesize a Simaris target (no traps/abilities, Hobbled Key)",
};

const RIVEN_COMPLICATION: Record<string, string> = {
  "/Lotus/Types/Challenges/Complications/Undetected": "while undetected",
  "/Lotus/Types/Challenges/Complications/Sliding": "while sliding",
  "/Lotus/Types/Challenges/Complications/AimGliding": "while Aim Gliding",
  "/Lotus/Types/Challenges/Complications/ResetOnDamageTaken": "without taking damage",
  "/Lotus/Types/Challenges/Complications/ResetOnDowned": "without dying or becoming downed",
  "/Lotus/Types/Challenges/Complications/PetPresent": "with an active pet present",
  "/Lotus/Types/Challenges/Complications/SentinelPresent": "with an active sentinel present",
  "/Lotus/Types/Challenges/Complications/SoloPlayer": "while alone or in Solo Mode",
  "/Lotus/Types/Challenges/Complications/ResetOnMissionFailure": "without failing a mission",
  "/Lotus/Types/Challenges/Complications/ResetOnAlarmRaised": "without raising any alarms",
  "/Lotus/Types/Challenges/Complications/ResetOnDisrupt": "without being disrupted by Magnetic Damage",
  "/Lotus/Types/Challenges/Complications/ResetOnProc": "without getting afflicted by a Status Effect",
  "/Lotus/Types/Challenges/Complications/ResetOnAllyDowned": "without an ally becoming downed",
  "/Lotus/Types/Challenges/Complications/Invisible": "while invisible",
  "/Lotus/Types/Challenges/Complications/EquippedDamageDebuffKey": "with an Extinguished Dragon Key",
  "/Lotus/Types/Challenges/Complications/EquippedHealthDebuffKey": "with a Bleeding Dragon Key",
  "/Lotus/Types/Challenges/Complications/EquippedShieldDebuffKey": "with a Decaying Dragon Key",
  "/Lotus/Types/Challenges/Complications/EquippedSpeedDebuffKey": "with a Hobbled Dragon Key",
  "/Lotus/Types/Challenges/Complications/ResetOnGearCipher": "without using ciphers",
  "/Lotus/Types/Challenges/Complications/ResetOnGearAirSupport": "without using air support",
  "/Lotus/Types/Challenges/Complications/ResetOnGearHealthRestores": "without using health consumables",
  "/Lotus/Types/Challenges/Complications/ResetOnGearShieldRestores": "without using shield-restoring consumables",
  "/Lotus/Types/Challenges/Complications/ResetOnGearAmmoRestores": "without using ammo consumables",
  "/Lotus/Types/Challenges/Complications/ResetOnGearEnergyRestores": "without using energy consumables",
  "/Lotus/Types/Challenges/Complications/ResetOnNewDay": "in one day",
};

const RIVEN_NAME_PARTS: Record<string, { p: string; s: string }> = {
  WeaponMeleeComboBonusOnHitMod: { p: "Laci", s: "Nus" },
  WeaponMeleeComboPointsOnHitMod: { p: "Laci", s: "Nus" },
  WeaponAmmoMaxMod: { p: "Ampi", s: "Bin" },
  WeaponMeleeFactionDamageCorpus: { p: "Manti", s: "Tron" },
  WeaponFactionDamageCorpus: { p: "Manti", s: "Tron" },
  WeaponMeleeFactionDamageGrineer: { p: "Argi", s: "Con" },
  WeaponFactionDamageGrineer: { p: "Argi", s: "Con" },
  WeaponMeleeFactionDamageInfested: { p: "Pura", s: "Ada" },
  WeaponFactionDamageInfested: { p: "Pura", s: "Ada" },
  WeaponFreezeDamageMod: { p: "Geli", s: "Do" },
  ComboDurationMod: { p: "Tempi", s: "Nem" },
  WeaponCritChanceMod: { p: "Crita", s: "Cron" },
  SlideAttackCritChanceMod: { p: "Pleci", s: "Nent" },
  WeaponCritDamageMod: { p: "Acri", s: "Tis" },
  WeaponDamageAmountMod: { p: "Visi", s: "Ata" },
  WeaponMeleeDamageMod: { p: "Visi", s: "Ata" },
  WeaponElectricityDamageMod: { p: "Vexi", s: "Tio" },
  WeaponFireDamageMod: { p: "Igni", s: "Pha" },
  WeaponMeleeFinisherDamageMod: { p: "Exi", s: "Cta" },
  WeaponFireRateMod: { p: "Croni", s: "Dra" },
  WeaponProjectileSpeedMod: { p: "Conci", s: "Nak" },
  WeaponMeleeComboInitialBonusMod: { p: "Para", s: "Um" },
  WeaponImpactDamageMod: { p: "Magna", s: "Ton" },
  WeaponClipMaxMod: { p: "Arma", s: "Tin" },
  WeaponMeleeComboEfficiencyMod: { p: "Forti", s: "Us" },
  WeaponFireIterationsMod: { p: "Sati", s: "Can" },
  WeaponToxinDamageMod: { p: "Toxi", s: "Tox" },
  WeaponPunctureDepthMod: { p: "Lexi", s: "Nok" },
  WeaponArmorPiercingDamageMod: { p: "Insi", s: "Cak" },
  WeaponReloadSpeedMod: { p: "Feva", s: "Tak" },
  WeaponMeleeRangeIncMod: { p: "Locti", s: "Tor" },
  WeaponSlashDamageMod: { p: "Sci", s: "Sus" },
  WeaponStunChanceMod: { p: "Hexa", s: "Dex" },
  WeaponProcTimeMod: { p: "Deci", s: "Des" },
  WeaponRecoilReductionMod: { p: "Zeti", s: "Mag" },
  WeaponZoomFovMod: { p: "Hera", s: "Lis" },
};

const RIVEN_WFM_ATTR: Record<string, string> = {
  // ── Melee / Zaw ──────────────────────────────────────────────────────────────
  WeaponMeleeDamageMod: "base_damage_/_melee_damage",
  WeaponMeleeRangeIncMod: "range",
  WeaponMeleeComboEfficiencyMod: "channeling_efficiency", // WFM still uses old "channeling" name
  WeaponMeleeFinisherDamageMod: "finisher_damage",
  WeaponMeleeComboInitialBonusMod: "initial_combo",
  WeaponMeleeComboBonusOnHitMod: "chance_to_gain_extra_combo_count", // "Additional Combo Count Chance" on WFM
  WeaponMeleeComboPointsOnHitMod: "chance_to_gain_combo_count",
  SlideAttackCritChanceMod: "critical_chance_on_slide_attack",
  ComboDurationMod: "combo_duration",
  WeaponMeleeFactionDamageCorpus: "damage_vs_corpus",
  WeaponMeleeFactionDamageGrineer: "damage_vs_grineer",
  WeaponMeleeFactionDamageInfested: "damage_vs_infested",
  // ── Ranged ───────────────────────────────────────────────────────────────────
  WeaponDamageAmountMod: "base_damage_/_melee_damage",
  WeaponFireIterationsMod: "multishot",
  WeaponAmmoMaxMod: "ammo_maximum",
  WeaponClipMaxMod: "magazine_capacity",
  WeaponReloadSpeedMod: "reload_speed",
  WeaponProjectileSpeedMod: "projectile_speed",
  WeaponZoomFovMod: "zoom",
  WeaponPunctureDepthMod: "punch_through",
  WeaponRecoilReductionMod: "recoil",
  WeaponFactionDamageCorpus: "damage_vs_corpus",
  WeaponFactionDamageGrineer: "damage_vs_grineer",
  WeaponFactionDamageInfested: "damage_vs_infested",
  // ── All weapons ──────────────────────────────────────────────────────────────
  WeaponCritChanceMod: "critical_chance",
  WeaponCritDamageMod: "critical_damage",
  WeaponArmorPiercingDamageMod: "puncture_damage",
  WeaponImpactDamageMod: "impact_damage",
  WeaponSlashDamageMod: "slash_damage",
  WeaponElectricityDamageMod: "electricity_damage",
  WeaponFireDamageMod: "heat_damage",
  WeaponFreezeDamageMod: "cold_damage",
  WeaponToxinDamageMod: "toxin_damage",
  WeaponFireRateMod: "fire_rate_/_attack_speed",
  WeaponProcTimeMod: "status_duration",
  WeaponStunChanceMod: "status_chance",
};

const RIVEN_STAT: Record<string, RS> = {
  // ── Melee / Zaw only ─────────────────────────────────────────────────────────
  WeaponMeleeDamageMod: { label: "Damage", unit: "%", caps: { ME: 0.0183 } },
  WeaponMeleeRangeIncMod: { label: "Range", unit: "m", caps: { ME: 0.02158 } },
  WeaponMeleeComboEfficiencyMod: { label: "Heavy Atk Efficiency", unit: "%", caps: { ME: 0.00816 } },
  WeaponMeleeFinisherDamageMod: { label: "Finisher Damage", unit: "%", caps: { ME: 0.0133 } },
  WeaponMeleeComboInitialBonusMod: { label: "Initial Combo", unit: "n", caps: { ME: 0.27224 } },
  WeaponMeleeComboBonusOnHitMod: { label: "Combo Count Chance", unit: "%", caps: { ME: 0.00653 } },
  WeaponMeleeComboPointsOnHitMod: { label: "Combo Count Chance", unit: "%", caps: { ME: -0.01165 } },
  SlideAttackCritChanceMod: { label: "Slide Crit Chance", unit: "%", caps: { ME: 0.013334 } },
  ComboDurationMod: { label: "Combo Duration", unit: "s", caps: { ME: 0.09 } },
  WeaponMeleeFactionDamageCorpus: { label: "Damage to Corpus", unit: "x", caps: { ME: 0.005 } },
  WeaponMeleeFactionDamageGrineer: { label: "Damage to Grineer", unit: "x", caps: { ME: 0.005 } },
  WeaponMeleeFactionDamageInfested: { label: "Damage to Infested", unit: "x", caps: { ME: 0.005 } },
  // ── Ranged only ──────────────────────────────────────────────────────────────
  WeaponDamageAmountMod: { label: "Damage", unit: "%", caps: { AG: 0.0111, PL: 0.0244, RI: 0.018333, SG: 0.0183 } },
  WeaponFireIterationsMod: { label: "Multishot", unit: "%", caps: { AG: 0.0067, PL: 0.0133, RI: 0.01, SG: 0.0133 } },
  WeaponAmmoMaxMod: { label: "Ammo Maximum", unit: "%", caps: { AG: 0.0111, PL: 0.01, RI: 0.00555, SG: 0.01 } },
  WeaponClipMaxMod: { label: "Magazine Capacity", unit: "%", caps: { AG: 0.0067, PL: 0.005555, RI: 0.005555, SG: 0.005555 } },
  WeaponReloadSpeedMod: { label: "Reload Speed", unit: "%", caps: { AG: 0.0111, PL: 0.005555, RI: 0.005555, SG: 0.005555 } },
  WeaponProjectileSpeedMod: { label: "Projectile Speed", unit: "%", caps: { PL: 0.01, RI: 0.01, SG: 0.01 } },
  WeaponZoomFovMod: { label: "Zoom", unit: "%", caps: { AG: 0.006666, PL: 0.0089, RI: 0.006666 } },
  WeaponPunctureDepthMod: { label: "Punch Through", unit: "m", caps: { AG: 0.03, PL: 0.03, RI: 0.03, SG: 0.03 } },
  WeaponRecoilReductionMod: { label: "Recoil", unit: "%", caps: { AG: -0.01, PL: -0.01, RI: -0.01, SG: -0.01 } },
  WeaponFactionDamageCorpus: { label: "Damage to Corpus", unit: "x", caps: { AG: 0.005, PL: 0.005, RI: 0.005, SG: 0.005 } },
  WeaponFactionDamageGrineer: { label: "Damage to Grineer", unit: "x", caps: { AG: 0.005, PL: 0.005, RI: 0.005, SG: 0.005 } },
  WeaponFactionDamageInfested: { label: "Damage to Infested", unit: "x", caps: { PL: 0.005, RI: 0.005, SG: 0.005 } },
  // ── All weapons ──────────────────────────────────────────────────────────────
  WeaponCritChanceMod: { label: "Critical Chance", unit: "%", caps: { AG: 0.0111, ME: 0.02, PL: 0.016666, RI: 0.016666, SG: 0.01 } },
  WeaponCritDamageMod: { label: "Critical Damage", unit: "%", caps: { AG: 0.0089, ME: 0.01, PL: 0.01, RI: 0.013333, SG: 0.01 } },
  WeaponArmorPiercingDamageMod: { label: "Puncture", unit: "%", caps: { AG: 0.01, ME: 0.0133, PL: 0.01333, RI: 0.01333, SG: 0.01333 } },
  WeaponImpactDamageMod: { label: "Impact", unit: "%", caps: { AG: 0.01, ME: 0.0133, PL: 0.013333, RI: 0.013333, SG: 0.013333 } },
  WeaponSlashDamageMod: { label: "Slash", unit: "%", caps: { AG: 0.01, ME: 0.0133, PL: 0.013333, RI: 0.013333, SG: 0.013333 } },
  WeaponElectricityDamageMod: { label: "Electricity", unit: "%", caps: { AG: 0.0133, ME: 0.01, PL: 0.01, RI: 0.01, SG: 0.01 } },
  WeaponFireDamageMod: { label: "Heat", unit: "%", caps: { AG: 0.0133, ME: 0.01, PL: 0.01, RI: 0.01, SG: 0.01 } },
  WeaponFreezeDamageMod: { label: "Cold", unit: "%", caps: { AG: 0.0133, ME: 0.01, PL: 0.01, RI: 0.01, SG: 0.01 } },
  WeaponToxinDamageMod: { label: "Toxin", unit: "%", caps: { AG: 0.0133, ME: 0.01, PL: 0.01, RI: 0.01, SG: 0.01 } },
  WeaponFireRateMod: { label: "Fire Rate / Atk Spd", unit: "%", caps: { AG: 0.00667, ME: 0.0061, PL: 0.0083, RI: 0.00667, SG: 0.01 } },
  WeaponProcTimeMod: { label: "Status Duration", unit: "%", caps: { AG: 0.01111, ME: 0.01111, PL: 0.01111, RI: 0.01111, SG: 0.01111 } },
  WeaponStunChanceMod: { label: "Status Chance", unit: "%", caps: { AG: 0.0067, ME: 0.01, PL: 0.01, RI: 0.01, SG: 0.01 } },
};

// ── Types ───────────────────────────────────────────────────────────────────

export type RivenStatValue = { tag: string; value: number };

export type OwnedRiven = {
  item_id: string;
  item_type: string;
  mod_name: string;
  riven_state: "unrevealed" | "revealed" | "unlocked" | null;
  compat: string | null;
  challenge_type: string | null;
  challenge_complication: string | null;
  lvl_req: number | null;
  polarity: string | null;
  buffs: RivenStatValue[];
  curses: RivenStatValue[];
  mod_rank: number;
  count: number;
  rerolls: number;
};

export type RivenAlternative = { label: string; matched: string[]; missing: string[]; score: number; verdict: string };
export type RivenAnalysis = {
  weapon: string;
  safe_negatives_present: string[];
  harmful_negatives: string[];
  score: number;
  verdict: string;
  notes: string;
  alternatives: RivenAlternative[];
};

export type SavedRiven = { id: string; weapon: string; label: string; stats_json: string; verdict: string; score: number; saved_at: string };
export type RollStat = { name: string; value: string; positive: boolean; useMultiplier?: boolean };
export type WfmRivenAttribute = { url_name: string; positive: boolean; value: number };

// ── Analyzer ────────────────────────────────────────────────────────────────

/** Every stat a roll can have; the sign is chosen per roll. */
export const ALL_STATS = [
  "Critical Damage",
  "Critical Chance",
  "Multishot",
  "Base Damage",
  "Fire Rate",
  "Status Chance",
  "Toxicity",
  "Heat",
  "Electricity",
  "Cold",
  "Punch Through",
  "Reload Speed",
  "Magazine Size",
  "Projectile Flight Speed",
  "Status Duration",
  "Damage to Infested",
  "Damage to Grineer",
  "Damage to Corpus",
  "Attack Speed",
  "Range",
  "Combo Count Chance",
  "Initial Combo",
  "Heavy Attack Efficiency",
  "Slide Critical Chance",
  "Zoom",
  "Recoil",
  "Puncture",
  "Impact",
  "Slash",
  "Ammo Maximum",
] as const;

export const MAX_SAVED = 50;
export const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Up to eight weapons containing the typed text. */
export function weaponSuggestions(weapons: readonly string[], typed: string): string[] {
  const q = typed.trim().toLowerCase();
  return q ? weapons.filter((w) => w.includes(q)).slice(0, 8) : [];
}

/** Adds a stat (positive; "Damage to …" as a multiplier) or removes it. */
export function toggleRollStat(stats: readonly RollStat[], name: string): RollStat[] {
  if (stats.some((s) => s.name === name)) return stats.filter((s) => s.name !== name);
  return [...stats, { name, value: "", positive: true, useMultiplier: name.startsWith("Damage to") }];
}

export const splitSigns = (stats: readonly RollStat[]) => ({
  positives: stats.filter((s) => s.positive).map((s) => s.name),
  negatives: stats.filter((s) => !s.positive).map((s) => s.name),
});

export type VerdictLevel = "great" | "good" | "mediocre" | "bad";
export function verdictLevel(verdict: string): VerdictLevel {
  if (verdict.startsWith("GREAT")) return "great";
  if (verdict.startsWith("GOOD")) return "good";
  if (verdict.startsWith("MED")) return "mediocre";
  return "bad";
}
/** "GOOD — usable" → "GOOD". */
export const verdictShort = (verdict: string) => (verdict.split("—")[0] ?? verdict).trim();

/** Default label of a new roll: "Soma · 13 Nov 2026". */
export function rollLabel(weapon: string, now: Date): string {
  return `${titleCase(weapon)} · ${String(now.getDate())} ${now.toLocaleString("en", { month: "short" })} ${String(now.getFullYear())}`;
}

export function parseRollStats(json: string): RollStat[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as RollStat[]) : [];
  } catch {
    return [];
  }
}

export const filledStats = (stats: readonly RollStat[]) => stats.filter((s) => s.value.trim() !== "");

/** Selecting for comparison: at most two. */
export function toggleCompare(ids: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else if (next.size < 2) next.add(id);
  return next;
}

// ── Owned rivens ────────────────────────────────────────────────────────────

export function rivenCategory(itemType: string): string {
  if (itemType.includes("Melee")) return "Melee";
  if (itemType.includes("Rifle")) return "Rifle";
  if (itemType.includes("Pistol") || itemType.includes("Kitgun")) return "Pistol";
  if (itemType.includes("Shotgun")) return "Shotgun";
  if (itemType.includes("Archgun") || itemType.includes("Archwing")) return "Arch-gun";
  if (itemType.includes("Zaw")) return "Zaw";
  return "Riven";
}

function rivenTypeKey(category: string): RT {
  if (category === "Arch-gun") return "AG";
  if (category === "Melee" || category === "Zaw") return "ME";
  if (category === "Shotgun") return "SG";
  if (category === "Rifle") return "RI";
  return "PL";
}

export function groupRivens(list: readonly OwnedRiven[]) {
  return {
    unlocked: list.filter((r) => r.riven_state === "unlocked" || (!r.riven_state && r.compat !== null)),
    revealed: list.filter((r) => r.riven_state === "revealed"),
    unrevealed: list.filter((r) => r.riven_state === "unrevealed"),
  };
}

const splitWords = (path: string) =>
  path
    .split("/")
    .pop()
    ?.replace(/([A-Z])/g, " $1")
    .trim() ?? "";

export function challengeText(type: string | null, complication: string | null): string {
  const challenge = type ? (RIVEN_CHALLENGE[type] ?? (splitWords(type) || "Unknown challenge")) : "Unknown challenge";
  if (!complication) return challenge;
  const comp = RIVEN_COMPLICATION[complication] ?? splitWords(complication);
  return comp ? `${challenge}, ${comp}` : challenge;
}

/**
 * The riven name from its buffs (curses do not count): 1–2 buffs → core of
 * the highest + suffix of the lowest; 3 buffs → highest-second + suffix.
 * Lowercase, like warframe.market.
 */
export function rivenModName(r: Pick<OwnedRiven, "buffs" | "mod_name">): string {
  if (r.mod_name) return r.mod_name;
  if (r.buffs.length === 0) return "";
  const sorted = [...r.buffs].sort((a, b) => b.value - a.value);
  const hi = RIVEN_NAME_PARTS[sorted[0]?.tag ?? ""];
  const lo = RIVEN_NAME_PARTS[sorted[sorted.length - 1]?.tag ?? ""];
  if (!hi || !lo) return "";
  const suffix = lo.s.toLowerCase();
  const mid = sorted.length >= 3 ? RIVEN_NAME_PARTS[sorted[1]?.tag ?? ""] : undefined;
  return mid ? `${hi.p.toLowerCase()}-${mid.p.toLowerCase()}${suffix}` : `${hi.p.toLowerCase()}${suffix}`;
}

type Ctx = { disposition: number; category: string; buffs: number; curses: number; rank: number };

/** Signed value in the stat's unit (fraction for % stats), or null without a cap for this weapon type. */
function rawValue(stat: RivenStatValue, positive: boolean, ctx: Ctx): number | null {
  const cap = RIVEN_STAT[stat.tag]?.caps[rivenTypeKey(ctx.category)];
  if (cap === undefined) return null;
  const roll = 0.9 + (stat.value / 0x3fffffff) * 0.2;
  const nb = Math.min(ctx.buffs, BUFF_ATTEN.length - 1);
  const nc = Math.min(ctx.curses, BUFF_ATTEN.length - 1);
  const atten = 1.5 * ctx.disposition * 10;
  return positive
    ? cap * atten * Math.pow(1.25, ctx.curses) * roll * (BUFF_ATTEN[nb] ?? 0) * (ctx.rank + 1)
    : -(cap * atten * roll * (CURSE_ATTEN[nb] ?? 0) * (BUFF_ATTEN[nc] ?? 0) * (ctx.rank + 1));
}

/** "+85.3% Critical Chance", "x1.07 Damage to Grineer", "-12.0% Zoom". */
export function statLabel(stat: RivenStatValue, positive: boolean, ctx: Ctx): string {
  const entry = RIVEN_STAT[stat.tag];
  const label = entry?.label ?? stat.tag;
  const v = rawValue(stat, positive, ctx);
  if (v === null || !entry) return `${positive ? "+" : "-"}${((stat.value / 0x3fffffff) * 100).toFixed(1)}% ${label}`;
  const s = v >= 0 ? "+" : "";
  switch (entry.unit) {
    case "%":
      return `${s}${(v * 100).toFixed(1)}% ${label}`;
    case "x":
      return `x${(1 + v).toFixed(2)} ${label}`;
    case "m":
      return `${s}${v.toFixed(1)}m ${label}`;
    case "s":
      return `${s}${v.toFixed(1)}s ${label}`;
    case "n":
      return `${s}${String(Math.round(v))} ${label}`;
  }
}

/** Value warframe.market expects: % signed (9.5 / -6.0), × as full multiplier (1.07). */
export function wfmValue(stat: RivenStatValue, positive: boolean, ctx: Ctx): number {
  const entry = RIVEN_STAT[stat.tag];
  const v = rawValue(stat, positive, ctx);
  if (v === null || !entry) return Number(((stat.value / 0x3fffffff) * 100 * (positive ? 1 : -1)).toFixed(1));
  switch (entry.unit) {
    case "%":
      return Number((v * 100).toFixed(1));
    case "x":
      return Number((1 + Math.abs(v)).toFixed(2));
    case "m":
      return Number(v.toFixed(2));
    case "s":
      return Number(v.toFixed(1));
    case "n":
      return Math.round(v);
  }
}

export const statContext = (r: OwnedRiven, disposition: number): Ctx => ({
  disposition,
  category: rivenCategory(r.item_type),
  buffs: r.buffs.length,
  curses: r.curses.length,
  rank: r.mod_rank,
});

/** Attributes for an auction; stats without a WFM name are left out (and counted). */
export function auctionAttributes(r: OwnedRiven, disposition: number): { attributes: WfmRivenAttribute[]; unmapped: number } {
  const ctx = statContext(r, disposition);
  const all = [
    ...r.buffs.map((b) => ({ url_name: RIVEN_WFM_ATTR[b.tag], positive: true, value: wfmValue(b, true, ctx) })),
    ...r.curses.map((c) => ({ url_name: RIVEN_WFM_ATTR[c.tag], positive: false, value: wfmValue(c, false, ctx) })),
  ];
  const attributes = all.filter((a): a is WfmRivenAttribute => a.url_name !== undefined);
  return { attributes, unmapped: all.length - attributes.length };
}

const POLARITY: Readonly<Record<string, { wfm: string; name: string }>> = {
  AP_ATTACK: { wfm: "madurai", name: "Madurai" },
  AP_DEFENSE: { wfm: "vazarin", name: "Vazarin" },
  AP_TACTIC: { wfm: "naramon", name: "Naramon" },
  AP_WARD: { wfm: "unairu", name: "Unairu" },
  AP_POWER: { wfm: "zenurik", name: "Zenurik" },
  AP_UMBRA: { wfm: "umbra", name: "Umbra" },
  AP_PRECEPT: { wfm: "penjaga", name: "Penjaga" },
};
export const polarityName = (p: string | null) => (p ? (POLARITY[p]?.name ?? null) : null);
export const wfmPolarity = (p: string | null) => (p ? (POLARITY[p]?.wfm ?? "madurai") : "madurai");

/** Display name → warframe.market slug (mirrors to_wfm_slug in Rust). */
export const toWfmSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const VEILED_SLUG: Readonly<Record<string, string>> = {
  Rifle: "rifle_riven_mod",
  Pistol: "pistol_riven_mod",
  Melee: "melee_riven_mod",
  Shotgun: "shotgun_riven_mod",
  "Arch-gun": "archgun_riven_mod",
  Zaw: "zaw_riven_mod",
};
export const veiledSlug = (category: string): string | null => VEILED_SLUG[category] ?? null;

export type AuctionForm = { type: "auction" | "direct"; start: string; buyout: string; direct: string; minRep: string };

/** Validates the sell form; returns prices or an error message. */
export function auctionPrices(f: AuctionForm): { start: number; buyout: number | null; minRep: number } | { error: string } {
  if (f.type === "direct") {
    const p = Number.parseInt(f.direct, 10);
    if (!p || p < 1) return { error: "Selling price must be at least 1 platinum." };
    return { start: p, buyout: p, minRep: 0 };
  }
  const start = Number.parseInt(f.start, 10);
  if (!start || start < 1) return { error: "Starting price must be at least 1 platinum." };
  const buyout = f.buyout.trim() ? Number.parseInt(f.buyout, 10) : null;
  if (buyout !== null && buyout < start) return { error: "Buyout price must be at least the starting price." };
  return { start, buyout, minRep: Number.parseInt(f.minRep, 10) || 0 };
}
