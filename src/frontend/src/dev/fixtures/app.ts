import type { CacheStatuses } from "../../domain/cache";
import { noResult } from "./market";
import type { Fixture } from "./scenario";

let monitoring = false;

/** App core: scanner, catalogue, account, updater. */
/** Fixed against the frozen test clock (2026-11-12T12:00:00Z = 1 794 484 800 s). */
const NOW_S = 1_794_484_800;
const CACHES: CacheStatuses = {
  worldstate: { source: "fresh", last_updated: NOW_S - 42, warning: null },
  "bulk-prices": { source: "refreshed", last_updated: NOW_S - 5 * 60, warning: null },
  catalogue: { source: "fresh", last_updated: NOW_S - 3 * 3600, warning: null },
  "drop-data": { source: "stale", last_updated: NOW_S - 2 * 86_400, warning: "Download failed, using the cached copy" },
  "riven-db": { source: "fresh", last_updated: NOW_S - 86_400, warning: null },
  "wfm-top": { source: "fresh", last_updated: NOW_S - 2 * 3600, warning: null },
};

export const appFixtures = {
  start_monitor: {
    alwaysDefault: true,
    default: () => {
      monitoring = true;
      return null;
    },
  } satisfies Fixture<null>,
  stop_monitor: {
    alwaysDefault: true,
    default: () => {
      monitoring = false;
      return null;
    },
  } satisfies Fixture<null>,
  get_monitor_status: { alwaysDefault: true, default: () => monitoring } satisfies Fixture<boolean>,
  poke_scan: noResult(),
  fetch_item_list: { default: () => 18_432, empty: () => 0 } satisfies Fixture<number, { force: boolean }>,
  prewarm_image_cache: noResult(),
  get_player_name: { default: () => "Tenno-Mock", empty: () => null } satisfies Fixture<string | null>,
  check_for_update: { alwaysDefault: true, default: () => null } satisfies Fixture<string | null>,
  install_update: noResult(),
  force_quit: noResult(),
  get_cache_statuses: { default: () => CACHES, empty: () => ({}) } satisfies Fixture<CacheStatuses>,
  refresh_all_caches: noResult(),
  refresh_bulk_prices: noResult(),
  clear_cache: noResult(),
  factory_reset: noResult(),
};
