/**
 * Position offsets per overlay: logical pixels on
 * top of the built-in place; 0 keeps it. The backend reads the relic and
 * relic pick offsets from the settings file, the main window the riven one.
 * Pure functions.
 */

export type OverlayOffsets = {
  relicPickX: number;
  relicPickY: number;
  relicX: number;
  relicY: number;
  rivenX: number;
  rivenY: number;
  statusX: number;
  statusY: number;
};
/** The overlay an offset pair belongs to (the key prefix in the settings file). */
export type OffsetTarget = "relic" | "relicPick" | "riven" | "status";

export const OFFSET_LIMIT = 3000;
/** Arrow keys in an offset field move this far. */
export const OFFSET_STEP = 10;
export const NO_OFFSETS: OverlayOffsets = { relicPickX: 0, relicPickY: 0, relicX: 0, relicY: 0, rivenX: 0, rivenY: 0, statusX: 0, statusY: 0 };

export const clampOffset = (v: number) => (Number.isFinite(v) ? Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, Math.round(v))) : 0);

/** Saved offsets; unknown or missing axes are 0 (the built-in place). */
export function offsetsFrom(v: unknown): OverlayOffsets {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const axis = (k: keyof OverlayOffsets) => clampOffset(Number(o[k] ?? 0));
  return {
    relicPickX: axis("relicPickX"),
    relicPickY: axis("relicPickY"),
    relicX: axis("relicX"),
    relicY: axis("relicY"),
    rivenX: axis("rivenX"),
    rivenY: axis("rivenY"),
    statusX: axis("statusX"),
    statusY: axis("statusY"),
  };
}

/** One overlay's offset pair. */
export const offsetOf = (offsets: OverlayOffsets, target: OffsetTarget) => ({ x: offsets[`${target}X`], y: offsets[`${target}Y`] });

/** The offsets with one overlay's axes changed (clamped); the other overlays keep theirs. */
export function withOffset(offsets: OverlayOffsets, target: OffsetTarget, change: { x?: number; y?: number }): OverlayOffsets {
  const next = { ...offsets };
  if (change.x !== undefined) next[`${target}X`] = clampOffset(change.x);
  if (change.y !== undefined) next[`${target}Y`] = clampOffset(change.y);
  return next;
}

/**
 * What an offset field holds as a number: a whole number within the limit,
 * or null while it is not one yet ("", "-", "12.5", "4000").
 */
export function offsetDraft(text: string): number | null {
  if (!/^-?\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return Math.abs(n) <= OFFSET_LIMIT ? n : null;
}
