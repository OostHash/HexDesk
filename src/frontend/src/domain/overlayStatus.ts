/** Settings for the short status line above the game window. */
export type OverlayStatusSettings = {
  enabled: boolean;
  durationSeconds: number;
};

export const STATUS_DURATION_RANGE = { min: 1, max: 10, fallback: 4 } as const;

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
};

/** Saved status settings, with safe defaults for missing or invalid values. */
export function overlayStatusFrom(value: unknown): OverlayStatusSettings {
  const settings = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enabled: settings.enabled !== false,
    durationSeconds: clampInt(settings.durationSeconds, STATUS_DURATION_RANGE.min, STATUS_DURATION_RANGE.max, STATUS_DURATION_RANGE.fallback),
  };
}
