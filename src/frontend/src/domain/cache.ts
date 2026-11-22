/** Backend data caches (backend cache.rs), shown in the header's Data chip. */

export type CacheSource = "fresh" | "refreshed" | "stale" | "fallback";

export type CacheStatus = {
  source: CacheSource;
  /** Unix seconds; null when never loaded. */
  last_updated: number | null;
  warning: string | null;
};

export type CacheStatuses = Readonly<Record<string, CacheStatus>>;

export type CacheHealth = "fresh" | "stale" | "offline";

/** Any fallback → offline; any stale or warning → stale; none known → offline. */
export function cacheHealth(statuses: CacheStatuses): CacheHealth {
  const values = Object.values(statuses);
  if (values.length === 0) return "offline";
  if (values.some((s) => s.source === "fallback")) return "offline";
  if (values.some((s) => s.source === "stale" || s.warning)) return "stale";
  return "fresh";
}

/** "12s ago", "5m ago", "3h ago", "2d ago" or "never". */
export function cacheAge(lastUpdated: number | null, nowMs: number): string {
  if (lastUpdated == null) return "never";
  const secs = Math.max(0, Math.floor(nowMs / 1000) - lastUpdated);
  if (secs < 60) return `${String(secs)}s ago`;
  if (secs < 3600) return `${String(Math.floor(secs / 60))}m ago`;
  if (secs < 86_400) return `${String(Math.floor(secs / 3600))}h ago`;
  return `${String(Math.floor(secs / 86_400))}d ago`;
}

const CACHE_LABEL: Readonly<Record<string, string>> = {
  worldstate: "Worldstate",
  "bulk-prices": "Bulk Prices",
  catalogue: "Catalogue",
  "drop-data": "Drop Data",
  "riven-db": "Riven DB",
  "wfm-top": "WFM Top Items",
};

export const cacheLabel = (key: string): string => CACHE_LABEL[key] ?? key;

/** Fresh and refreshed are fine, stale is a warning, fallback means no live data. */
export function sourceTone(source: CacheSource): "success" | "warning" | "neutral" {
  if (source === "stale") return "warning";
  if (source === "fallback") return "neutral";
  return "success";
}
