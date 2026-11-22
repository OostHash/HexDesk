/** Settings rules that are not owned by one screen. */

export const AUTO_INVISIBLE_RANGE = { min: 1, max: 480, fallback: 30 } as const;

/** Whole minutes within 1–480; anything else falls back to 30. */
export function clampMinutes(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return AUTO_INVISIBLE_RANGE.fallback;
  return Math.min(AUTO_INVISIBLE_RANGE.max, Math.max(AUTO_INVISIBLE_RANGE.min, n));
}

export const autoInvisibleMinutes = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? clampMinutes(String(v)) : AUTO_INVISIBLE_RANGE.fallback;

/**
 * Whether the ocrs models are allowed, as the backend reads it: an older settings file that chose ocrs as an
 * engine (`ocrEngine`, `ocrEngines`) has them on disk already.
 */
export function ocrModelsFrom(settings: Readonly<Record<string, unknown>>): boolean {
  if (typeof settings.ocrModels === "boolean") return settings.ocrModels;
  const engines = settings.ocrEngines;
  const chosen = engines !== null && typeof engines === "object" ? Object.values(engines as Record<string, unknown>) : [];
  return settings.ocrEngine === "ocrs" || chosen.includes("ocrs");
}
