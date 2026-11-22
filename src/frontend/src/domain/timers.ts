import { duviriCycle, nextUtcMidnight, nextWeeklyReset } from "./time.ts";
import type { WorldState } from "./worldstate.types.ts";

/**
 * Stable timer ids, persisted in settings as `timerFavorites` and shown in
 * the modular window. Never rename one without an alias below.
 */
export const TIMER_LABELS = {
  "cetus-cycle": "Cetus",
  "vallis-cycle": "Orb Vallis",
  "cambion-cycle": "Cambion Drift",
  "zariman-cycle": "Zariman",
  "duviri-spiral": "Duviri Spiral",
  "bounty-cetus": "Cetus Bounties",
  "bounty-vallis": "Vallis Bounties",
  "bounty-cambion": "Cambion Bounties",
  "bounty-zariman": "Zariman Bounties",
  "bounty-hex": "Hex Bounties",
  sortie: "Sortie",
  "archon-hunt": "Archon Hunt",
  "daily-reset": "Daily Reset",
  "weekly-reset": "Weekly Reset",
  "void-trader": "Void Trader",
  nightwave: "Nightwave",
  "prime-resurgence": "Prime Resurgence",
  circuit: "The Circuit",
  kahl: "Kahl / Break Narmer",
  "deep-archimedea": "Deep Archimedea",
} as const;

export type TimerId = keyof typeof TIMER_LABELS;

/**
 * Old ids that may still be saved. An earlier Duviri tile stored
 * "duviri-cycle" while everything else expected "duviri-spiral".
 */
const ALIASES: Readonly<Record<string, TimerId>> = { "duviri-cycle": "duviri-spiral" };

export function normalizeTimerId(id: string): TimerId | null {
  if (Object.hasOwn(TIMER_LABELS, id)) return id as TimerId;
  return ALIASES[id] ?? null;
}

/** Saved favourites, normalised and de-duplicated; unknown ids are dropped. */
export function normalizeFavorites(ids: readonly string[]): TimerId[] {
  const out: TimerId[] = [];
  for (const id of ids) {
    const timer = normalizeTimerId(id);
    if (timer && !out.includes(timer)) out.push(timer);
  }
  return out;
}

export type TimerInfo = { state: string; expiry: string };

/** State text and expiry for a timer id, or null when the worldstate has no data for it. */
export function getTimerInfo(id: TimerId, ws: WorldState, now: number): TimerInfo | null {
  const bounty = (key: string): TimerInfo | null => {
    const b = ws.bounties?.[key];
    return b ? { state: `${String(b.jobCount)} jobs`, expiry: b.expiry } : null;
  };
  switch (id) {
    case "cetus-cycle":
      return ws.cetus ? { state: ws.cetus.isDay ? "Day" : "Night", expiry: ws.cetus.expiry } : null;
    case "vallis-cycle":
      return ws.vallis ? { state: ws.vallis.isWarm ? "Warm" : "Cold", expiry: ws.vallis.expiry } : null;
    case "cambion-cycle":
      return ws.cambion ? { state: "Active", expiry: ws.cambion.expiry } : null;
    case "zariman-cycle":
      return ws.zariman ? { state: "Active", expiry: ws.zariman.expiry } : null;
    case "duviri-spiral": {
      const d = duviriCycle(now);
      return { state: d.mood, expiry: d.expiry };
    }
    case "bounty-cetus":
      return bounty("cetus");
    case "bounty-vallis":
      return bounty("vallis");
    case "bounty-cambion":
      return bounty("cambion");
    case "bounty-zariman":
      return bounty("zariman");
    case "bounty-hex":
      return bounty("hex");
    case "sortie":
      return ws.sortie ? { state: ws.sortie.faction, expiry: ws.sortie.expiry } : null;
    case "archon-hunt":
      return ws.archonHunt ? { state: ws.archonHunt.boss, expiry: ws.archonHunt.expiry } : null;
    case "daily-reset":
      return { state: "UTC 00:00", expiry: nextUtcMidnight(now) };
    case "weekly-reset":
      return { state: "Monday", expiry: nextWeeklyReset(now) };
    case "void-trader":
      return ws.voidTrader
        ? { state: ws.voidTrader.active ? "Here" : "Away", expiry: ws.voidTrader.active ? ws.voidTrader.expiry : ws.voidTrader.activation }
        : null;
    case "nightwave":
      return ws.nightwave?.active ? { state: `Season ${String(ws.nightwave.season)}`, expiry: ws.nightwave.expiry } : null;
    case "prime-resurgence":
      return ws.primeResurgence?.active ? { state: "Active", expiry: ws.primeResurgence.expiry } : null;
    case "circuit":
      return ws.circuit ? { state: "Weekly", expiry: ws.circuit.expiry } : null;
    case "kahl":
      return ws.kahl ? { state: "Weekly", expiry: ws.kahl.expiry } : null;
    case "deep-archimedea":
      return ws.deepArchimedea ? { state: "Weekly", expiry: ws.deepArchimedea.expiry } : null;
  }
}
