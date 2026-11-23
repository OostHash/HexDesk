import type { FissureVariant, WsFissure, WsStorm } from "./worldstate.types.ts";

/** A saved fissure watch (persisted in settings as `fissureWatches`). */
export type FissureWatch = {
  id: string;
  tier: string;
  missionType: string;
  variant: "any" | FissureVariant;
};

export const WATCH_TIERS = ["Any", "Omnia", "Lith", "Meso", "Neo", "Axi", "Requiem"] as const;

export const WATCH_VARIANTS: ReadonlyArray<{ value: FissureWatch["variant"]; label: string }> = [
  { value: "any", label: "Any" },
  { value: "normal", label: "Normal" },
  { value: "hard", label: "Steel Path" },
  { value: "storm", label: "Storm" },
];

const STAR_CHART = [
  "Any",
  "Rescue",
  "Capture",
  "Defense",
  "Survival",
  "Excavation",
  "Interception",
  "Disruption",
  "Sabotage",
  "Spy",
  "Mobile Defense",
  "Extermination",
  "Assassination",
  "Assault",
  "Void Cascade",
  "Void Flood",
  "Alchemy",
];

/** Mission types per variant (storms are Railjack: a different pool). */
export const MISSION_TYPES_BY_VARIANT: Readonly<Record<FissureWatch["variant"], readonly string[]>> = {
  any: [...STAR_CHART, "Skirmish", "Volatile"],
  normal: STAR_CHART,
  hard: STAR_CHART,
  storm: ["Any", "Skirmish", "Volatile", "Defense", "Extermination", "Sabotage", "Assassination"],
};

/**
 * Whether a fissure matches a watch: variant first; tier with bidirectional Omnia (an Omnia watch matches every
 * tier except Requiem, an Omnia fissure matches every watch except Requiem);
 * then mission type.
 */
export function matchesWatch(watch: FissureWatch, fissure: WsFissure | WsStorm, variant: FissureVariant): boolean {
  if (watch.variant !== "any" && watch.variant !== variant) return false;
  if (watch.tier !== "Any") {
    if (watch.tier === "Omnia") {
      if (fissure.tier === "Requiem") return false;
    } else if (fissure.tier === "Omnia") {
      if (watch.tier === "Requiem") return false;
    } else if (watch.tier !== fissure.tier) {
      return false;
    }
  }
  return watch.missionType === "Any" || fissure.missionType === watch.missionType;
}

const isWatch = (value: unknown): value is FissureWatch =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as FissureWatch).id === "string" &&
  typeof (value as FissureWatch).tier === "string" &&
  typeof (value as FissureWatch).missionType === "string" &&
  typeof (value as FissureWatch).variant === "string";

/** Valid watches from the settings file (`fissureWatches`). */
export const watchesFrom = (raw: unknown): FissureWatch[] => (Array.isArray(raw) ? raw.filter(isWatch) : []);

/** Sorted copy by tier (Lith → Requiem). */
export function sortByTier<T extends { tierNum: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.tierNum - b.tierNum);
}

/** Domain colour name per relic tier, for --hex-tone. */
export function tierTone(tier: string): "tier-lith" | "tier-meso" | "tier-neo" | "tier-axi" | "tier-requiem" | "tier-omnia" | null {
  switch (tier) {
    case "Lith":
      return "tier-lith";
    case "Meso":
      return "tier-meso";
    case "Neo":
      return "tier-neo";
    case "Axi":
      return "tier-axi";
    case "Requiem":
      return "tier-requiem";
    case "Omnia":
      return "tier-omnia";
    default:
      return null;
  }
}

export type MatchedFissure = { fissure: WsFissure | WsStorm; variant: FissureVariant };
/** Per watch id: the fissure ids it matched last time. */
export type SeenFissures = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * New matches since the last poll, for OS notifications: a newly added
 * watch announces what is live right now; watches
 * restored from settings at startup are seeded silently; `live` replaces the
 * caller's seen-state, which drops expired fissures and removed watches.
 */
export function collectNewMatches(
  ws: { fissures?: WsFissure[]; spFissures?: WsFissure[]; voidStorms?: WsStorm[] },
  watches: readonly FissureWatch[],
  seen: SeenFissures,
  restoredIds: ReadonlySet<string> = new Set(),
): { fresh: MatchedFissure[]; live: Map<string, Set<string>> } {
  const byVariant: Array<[ReadonlyArray<WsFissure | WsStorm>, FissureVariant]> = [
    [ws.fissures ?? [], "normal"],
    [ws.spFissures ?? [], "hard"],
    [ws.voidStorms ?? [], "storm"],
  ];
  const live = new Map<string, Set<string>>();
  const fresh = new Map<string, MatchedFissure>();
  for (const watch of watches) {
    const matched = new Set<string>();
    const previous = seen.get(watch.id);
    const announces = previous !== undefined || !restoredIds.has(watch.id);
    for (const [list, variant] of byVariant) {
      for (const fissure of list) {
        if (!fissure.id || !matchesWatch(watch, fissure, variant)) continue;
        matched.add(fissure.id);
        if (announces && !previous?.has(fissure.id)) fresh.set(fissure.id, { fissure, variant });
      }
    }
    live.set(watch.id, matched);
  }
  return { fresh: [...fresh.values()], live };
}
