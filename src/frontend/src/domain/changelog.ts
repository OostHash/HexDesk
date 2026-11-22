import type { ClockFormat } from "./statistics";
import type { ChangeEntry } from "./inventory";

/** Changes less than this many seconds apart belong to one scan batch. */
export const BATCH_GAP_SECONDS = 8;
/** Collapsed feed: each change of a new batch shows this long. */
export const FEED_STEP_MS = 4500;
export const LOG_HEIGHT = { min: 100, max: 800, initial: 270, maxShare: 0.8 } as const;

export type LogItem = { name: string; category: string; image_name?: string | null };

/** Newest batch: changes from the top until a gap of more than 8 s. */
export function latestBatch(changes: readonly ChangeEntry[]): ChangeEntry[] {
  const first = changes[0];
  if (!first) return [];
  const batch = [first];
  for (let i = 1; i < changes.length; i++) {
    const prev = changes[i - 1];
    const cur = changes[i];
    if (!prev || !cur || prev.timestamp - cur.timestamp > BATCH_GAP_SECONDS) break;
    batch.push(cur);
  }
  return batch;
}

/** Number of increases and decreases in a batch. */
export function batchCounts(batch: readonly ChangeEntry[]): { up: number; down: number } {
  let up = 0;
  let down = 0;
  for (const c of batch) {
    if (c.delta > 0) up++;
    else if (c.delta < 0) down++;
  }
  return { up, down };
}

/** Stable identity of a change (the id is 0 for changes not stored yet). */
export const changeKey = (c: ChangeEntry) => `${String(c.id ?? 0)}:${c.unique_name}:${String(c.timestamp)}`;

/** True when a change starts a new batch compared to the one above it. */
export const startsBatch = (changes: readonly ChangeEntry[], index: number): boolean => {
  const prev = changes[index - 1];
  const cur = changes[index];
  return index > 0 && prev !== undefined && cur !== undefined && prev.timestamp - cur.timestamp > BATCH_GAP_SECONDS;
};

/** Catalogue name and category, or the logged name and "Miscellaneous". */
export function describeChange(change: ChangeEntry, item: LogItem | undefined): { name: string; category: string } {
  return { name: item?.name ?? change.item_name, category: item?.category ?? "Miscellaneous" };
}

/** Case-insensitive match on name or category. */
export function filterChanges(
  changes: readonly ChangeEntry[],
  lookup: (uniqueName: string) => LogItem | undefined,
  query: string,
): readonly ChangeEntry[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return changes;
  return changes.filter((c) => {
    const { name, category } = describeChange(c, lookup(c.unique_name));
    return name.toLocaleLowerCase().includes(q) || category.toLocaleLowerCase().includes(q);
  });
}

/** Hours and minutes of a unix-seconds time, in the clock setting. */
export function formatClockTime(unixSeconds: number, clock: ClockFormat, locale: string): string {
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  if (clock !== "auto") options.hour12 = clock === "12h";
  return new Date(unixSeconds * 1000).toLocaleTimeString(locale, options);
}

/**
 * Day, month and time of a change, e.g. "19 Nov · 14:05": "Changed recently"
 * can reach back days, so a time alone is ambiguous.
 */
export function formatChangeTime(unixSeconds: number, clock: ClockFormat, locale: string): string {
  const date = new Date(unixSeconds * 1000);
  return `${date.toLocaleDateString(locale, { day: "numeric", month: "short" })} · ${formatClockTime(unixSeconds, clock, locale)}`;
}

/** Largest height the dock may take in a window of this height. */
export const maxLogHeight = (windowHeight: number) =>
  Math.max(LOG_HEIGHT.min, Math.min(LOG_HEIGHT.max, Math.floor(windowHeight * LOG_HEIGHT.maxShare)));
