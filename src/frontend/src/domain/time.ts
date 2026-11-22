/** Time helpers for world timers. Pure functions; `now` is always passed in. */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2d 3h 4m", "3h 4m 5s" or "4m 5s"; "—" when the time has passed. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const s = Math.floor(ms / SECOND) % 60;
  const m = Math.floor(ms / MINUTE) % 60;
  const h = Math.floor(ms / HOUR) % 24;
  const d = Math.floor(ms / DAY);
  if (d > 0) return `${String(d)}d ${String(h)}h ${String(m)}m`;
  if (h > 0) return `${String(h)}h ${String(m)}m ${String(s)}s`;
  return `${String(m)}m ${String(s)}s`;
}

export function untilExpiry(expiry: string, now: number): number {
  return new Date(expiry).getTime() - now;
}

/** Next 00:00 UTC (daily reset). */
export function nextUtcMidnight(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

/** Next Monday 00:00 UTC (weekly reset). */
export function nextWeeklyReset(now: number): string {
  const d = new Date(now);
  const day = d.getUTCDay();
  const add = day === 0 ? 1 : 8 - day;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add)).toISOString();
}

export const DUVIRI_MOODS = ["Joy", "Anger", "Envy", "Sorrow", "Fear", "Neutral"] as const;
export type DuviriMood = (typeof DUVIRI_MOODS)[number];

const DUVIRI_EPOCH_MS = Date.UTC(2023, 2, 22, 2); // 2023-03-22T02:00:00Z
const DUVIRI_MOOD_MS = 2 * HOUR;

/** Current Duviri Spiral mood, when it changes, and the mood after it. */
export function duviriCycle(now: number): { mood: DuviriMood; next: DuviriMood; expiry: string } {
  const step = Math.floor((now - DUVIRI_EPOCH_MS) / DUVIRI_MOOD_MS);
  const index = ((step % DUVIRI_MOODS.length) + DUVIRI_MOODS.length) % DUVIRI_MOODS.length;
  const mood = DUVIRI_MOODS[index] ?? "Neutral";
  const next = DUVIRI_MOODS[(index + 1) % DUVIRI_MOODS.length] ?? "Joy";
  return { mood, next, expiry: new Date(DUVIRI_EPOCH_MS + (step + 1) * DUVIRI_MOOD_MS).toISOString() };
}
