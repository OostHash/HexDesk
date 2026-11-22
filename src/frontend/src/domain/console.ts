/**
 * Activity console rules: the entries `hexdesk-diag` records, how they are
 * filtered and how one is written as a log line. Pure functions.
 */

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

/** A repeat line: how often entry `of` came again and when the last one was. */
export type LogRepeat = { of: number; count: number; until: string; last_op: number | null };

/** One log entry, as `get_recent_logs` and the `diag-entry` event send it. Already redacted. */
export type LogEntry = {
  id: number;
  /** RFC 3339 with offset, e.g. "2026-11-18T15:03:12.481+01:00". */
  time: string;
  level: LogLevel;
  source: string;
  /** `source.kind` for errors, e.g. "scanner.not_found". */
  code: string | null;
  message: string;
  fields: Record<string, string>;
  causes: string[];
  /** The operation (#42) the entry belongs to. */
  op: number | null;
  repeat: LogRepeat | null;
};

/** The levels the console filters on; trace entries count as debug. */
export const CONSOLE_LEVELS = ["error", "warn", "info", "debug"] as const;
export type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];

export const LEVEL_LABELS: Record<ConsoleLevel, string> = { error: "Errors", warn: "Warnings", info: "Info", debug: "Debug" };

export type ConsoleFilter = {
  levels: ReadonlySet<ConsoleLevel>;
  /** The sources to show; empty shows every source. */
  sources: ReadonlySet<string>;
  /** One operation, or null for all. */
  op: number | null;
  /** Case-insensitive text in the message, code or fields. */
  text: string;
};

/** Readable by default: debug entries are there, but hidden until asked for. */
export const DEFAULT_FILTER: ConsoleFilter = { levels: new Set(["error", "warn", "info"]), sources: new Set(), op: null, text: "" };

/** How many entries the console keeps, the same as the backend ring buffer. */
export const MAX_ENTRIES = 2000;

export const consoleLevel = (level: LogLevel): ConsoleLevel => (level === "trace" ? "debug" : level);

export function matchesFilter(entry: LogEntry, filter: ConsoleFilter): boolean {
  if (!filter.levels.has(consoleLevel(entry.level))) return false;
  if (filter.sources.size > 0 && !filter.sources.has(entry.source)) return false;
  if (filter.op !== null && entry.op !== filter.op && entry.repeat?.last_op !== filter.op) return false;
  const text = filter.text.trim().toLowerCase();
  if (text === "") return true;
  const haystack = [entry.message, entry.code ?? "", ...Object.entries(entry.fields).map(([k, v]) => `${k}=${v}`), ...entry.causes]
    .join("\n")
    .toLowerCase();
  return haystack.includes(text);
}

export const filterEntries = (entries: readonly LogEntry[], filter: ConsoleFilter): LogEntry[] => entries.filter((e) => matchesFilter(e, filter));

/** Every source in the entries, sorted, for the source filter. */
export const sourcesOf = (entries: readonly LogEntry[]): string[] => [...new Set(entries.map((e) => e.source))].sort();

/**
 * Adds entries that are not there yet, keeps them in id order and drops the
 * oldest past `max`. The initial fetch and live events can overlap.
 */
export function mergeEntries(current: readonly LogEntry[], incoming: readonly LogEntry[], max = MAX_ENTRIES): LogEntry[] {
  if (incoming.length === 0) return current as LogEntry[];
  const byId = new Map<number, LogEntry>();
  for (const e of current) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  const merged = [...byId.values()].sort((a, b) => a.id - b.id);
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

const TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** "15:03:12" from an RFC 3339 time, as the time was where it was logged. */
export function clockTime(iso: string): string {
  return TIME.exec(iso)?.[2] ?? iso;
}

/** "2026-11-18 15:03:12.481 +01:00", the log file's time column. */
export function logTime(iso: string): string {
  const m = TIME.exec(iso);
  if (!m) return iso;
  const [, date = "", clock = "", fraction = "", zone = ""] = m;
  const millis = (fraction.slice(1) + "000").slice(0, 3);
  return `${date} ${clock}.${millis} ${zone === "Z" ? "+00:00" : zone}`;
}

/** "… repeated 36 times until 15:09:44, last in #78" */
export function repeatText(repeat: LogRepeat): string {
  const times = repeat.count === 1 ? "time" : "times";
  const last = repeat.last_op === null ? "" : `, last in #${String(repeat.last_op)}`;
  return `… repeated ${String(repeat.count)} ${times} until ${clockTime(repeat.until)}${last}`;
}

/** Line breaks written as `\n`, so a message or cause stays on its own line. */
const oneLine = (text: string) => text.replace(/\r\n|\r|\n/g, "\\n");

const quote = (value: string) => (value === "" || /[\s"=]/.test(value) ? JSON.stringify(value) : value);

/**
 * The entry as the log file writes it (`Entry::to_line` in hexdesk-diag), so a
 * copied line reads the same as one from the file.
 */
export function entryLine(entry: LogEntry): string {
  const op = entry.op === null ? "" : `#${String(entry.op)}`;
  const prefix = `${logTime(entry.time)} ${entry.level.toUpperCase().padEnd(5)} ${entry.source.padEnd(10)} ${op.padEnd(6)} `;
  let line = prefix + oneLine(entry.message) + (entry.repeat ? ` ${repeatText(entry.repeat)}` : "");
  const fields = Object.entries(entry.fields);
  if (fields.length > 0) line += " " + fields.map(([k, v]) => ` ${k}=${quote(v)}`).join("");
  if (entry.code !== null) line += ` [${entry.code}]`;
  const indent = " ".repeat(prefix.length);
  for (const cause of entry.causes) line += `\n${indent}caused by: ${oneLine(cause)}`;
  return line;
}
