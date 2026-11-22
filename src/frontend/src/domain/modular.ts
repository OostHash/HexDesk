import type { Ownership } from "./completionist";
import { matchesWatch, sortByTier, type FissureWatch, type MatchedFissure } from "./fissures";
import { mergeComponents, type RecipeComponent } from "./foundry";
import type { WsFissure, WsStorm } from "./worldstate.types";

/** Modular window rules. */

export const SECTION_IDS = ["tracking", "favorites", "timers", "fissures"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const MODULAR_WIDTH = { min: 160, max: 500, initial: 240, reserved: 582 } as const;
export const POPOUT_SIZE = { minWidth: 180, minHeight: 300, height: 700 } as const;

const isSection = (v: unknown): v is SectionId => (SECTION_IDS as readonly unknown[]).includes(v);

/** Stored order, unknown ids dropped, missing sections appended. */
export function sectionOrderFrom(raw: unknown): SectionId[] {
  const stored = Array.isArray(raw) ? raw.filter(isSection) : [];
  const unique = [...new Set(stored)];
  return [...unique, ...SECTION_IDS.filter((id) => !unique.includes(id))];
}

/** Strings from a stored list (tracked, favorites). */
export const idListFrom = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : []);

/** Copy with the item at `index` swapped one place up (-1) or down (1); unchanged at the ends. */
export function moveItem<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  const next = [...list];
  const a = next[index];
  const b = next[target];
  if (a === undefined || b === undefined) return next;
  next[index] = b;
  next[target] = a;
  return next;
}

/** Docked width within 160–500 and never wider than the window allows. */
export function clampModularWidth(width: number, windowWidth: number): number {
  const roomy = Math.max(MODULAR_WIDTH.min, windowWidth - MODULAR_WIDTH.reserved);
  return Math.round(Math.max(MODULAR_WIDTH.min, Math.min(MODULAR_WIDTH.max, roomy, width)));
}

export const modularWidthFrom = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(MODULAR_WIDTH.min, Math.min(MODULAR_WIDTH.max, v)) : MODULAR_WIDTH.initial;

// ── Tracking ────────────────────────────────────────────────────────────────

export type TrackedNeed = { unique_name: string; name: string; needed: number; owned: number; shortage: number };

const qty = (own: Ownership, uniqueName: string) => own.quantities[uniqueName] ?? 0;

/**
 * What a tracked item still takes: an intermediate you
 * own none of is broken down into its own recipe, otherwise it is compared
 * as is. The item itself is dropped (a data quirk); rows with the same name
 * are merged, counting the best-owned key. A–Z.
 */
export function trackedNeeds(selfId: string, recipe: readonly RecipeComponent[], own: Ownership): TrackedNeed[] {
  const acc = new Map<string, { name: string; needed: number }>();
  const walk = (nodes: readonly RecipeComponent[], multiplier: number) => {
    for (const node of mergeComponents(nodes)) {
      const total = node.count * multiplier;
      if (node.components.length === 0 || qty(own, node.unique_name) > 0) {
        const prev = acc.get(node.unique_name);
        acc.set(node.unique_name, { name: node.name, needed: (prev?.needed ?? 0) + total });
      } else {
        walk(node.components, Math.ceil(total / (node.result_count || 1)));
      }
    }
  };
  walk(recipe, 1);
  acc.delete(selfId);

  const byName = new Map<string, { unique_name: string; needed: number; keys: string[] }>();
  for (const [unique_name, { name, needed }] of acc) {
    const existing = byName.get(name);
    if (existing) byName.set(name, { ...existing, needed: existing.needed + needed, keys: [...existing.keys, unique_name] });
    else byName.set(name, { unique_name, needed, keys: [unique_name] });
  }
  return [...byName.entries()]
    .map(([name, { unique_name, needed, keys }]) => {
      const owned = Math.max(...keys.map((k) => qty(own, k)));
      return { unique_name, name, needed, owned, shortage: Math.max(0, needed - owned) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type TrackedStatus = "owned" | "ready" | "covered" | "none";

/** Owned; every part in hand (ready to build); every resource covered; or nothing yet. */
export function trackedStatus(
  itemId: string,
  recipe: readonly RecipeComponent[] | undefined,
  needs: readonly TrackedNeed[],
  own: Ownership,
): TrackedStatus {
  if (qty(own, itemId) > 0) return "owned";
  if (recipe && recipe.length > 0 && mergeComponents(recipe).every((c) => qty(own, c.unique_name) >= (c.count || 1))) return "ready";
  if (needs.length > 0 && needs.every((n) => n.shortage === 0)) return "covered";
  return "none";
}

// ── Fissures ────────────────────────────────────────────────────────────────

/** Active fissures and storms that match any watch, sorted by tier. */
export function watchedFissures(
  ws: { fissures?: WsFissure[]; spFissures?: WsFissure[]; voidStorms?: WsStorm[] } | undefined,
  watches: readonly FissureWatch[],
): MatchedFissure[] {
  if (!ws || watches.length === 0) return [];
  const pick = (list: ReadonlyArray<WsFissure | WsStorm> | undefined, variant: MatchedFissure["variant"]) =>
    (list ?? []).filter((f) => watches.some((w) => matchesWatch(w, f, variant))).map((fissure) => ({ fissure, variant }));
  const all = [...pick(ws.fissures, "normal"), ...pick(ws.spFissures, "hard"), ...pick(ws.voidStorms, "storm")];
  return sortByTier(all.map((m) => ({ ...m, tierNum: m.fissure.tierNum }))).map(({ fissure, variant }) => ({ fissure, variant }));
}

export const VARIANT_LABEL: Readonly<Record<MatchedFissure["variant"], string>> = { normal: "Normal", hard: "Steel Path", storm: "Storm" };
