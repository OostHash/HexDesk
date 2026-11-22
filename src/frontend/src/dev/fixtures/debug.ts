import type { LogEntry } from "../../domain/console";
import { noResult } from "./market";
import type { Fixture } from "./scenario";

const at = (seconds: number) => `2026-11-18T15:03:${String(seconds).padStart(2, "0")}.000+01:00`;

/** A short session: the scanner fails twice, finds the blob, a market request is refused. */
const RECENT_LOGS: LogEntry[] = [
  {
    id: 1,
    time: at(0),
    level: "info",
    source: "app",
    code: null,
    message: "HexDesk starting",
    fields: { version: "1.1.0" },
    causes: [],
    op: null,
    repeat: null,
  },
  {
    id: 2,
    time: at(2),
    level: "info",
    source: "scanner",
    code: null,
    message: "Warframe process found",
    fields: { pid: "18244", hexdesk_elevated: "false" },
    causes: [],
    op: null,
    repeat: null,
  },
  {
    id: 3,
    time: at(5),
    level: "warn",
    source: "scanner",
    code: "scanner.not_found",
    message: "Account blob not found: no start marker in any readable memory region",
    fields: { regions_read: "412", bytes_mb: "1830" },
    causes: [],
    op: 12,
    repeat: null,
  },
  {
    id: 4,
    time: at(6),
    level: "debug",
    source: "scanner",
    code: null,
    message: "Inventory scan finished",
    fields: { elapsed_ms: "940" },
    causes: [],
    op: 12,
    repeat: null,
  },
  {
    id: 5,
    time: at(40),
    level: "warn",
    source: "scanner",
    code: "scanner.not_found",
    message: "Account blob not found: no start marker in any readable memory region",
    fields: {},
    causes: [],
    op: null,
    repeat: { of: 3, count: 3, until: at(36), last_op: 15 },
  },
  {
    id: 6,
    time: at(41),
    level: "info",
    source: "scanner",
    code: null,
    message: "Account blob found",
    fields: { unique: "412", mods: "880" },
    causes: [],
    op: 16,
    repeat: null,
  },
  {
    id: 7,
    time: at(50),
    level: "warn",
    source: "market",
    code: "market.denied",
    message: "Order could not be created: warframe.market answered 401",
    fields: { status: "401", url: "https://api.warframe.market/v2/order" },
    causes: ['response: {"error":"unauthorized"}'],
    op: null,
    repeat: null,
  },
];

export const debugFixtures = {
  get_recent_logs: { default: () => RECENT_LOGS, empty: () => [] } satisfies Fixture<LogEntry[], { limit?: number }>,
  remove_logs: noResult(),
  export_diagnostics: {
    alwaysDefault: true,
    default: () => "C:/Users/Tenno/Downloads/hexdesk-diagnostics-2026-11-18-150312.zip",
  } satisfies Fixture<string>,
  show_diagnostics_export: noResult<{ path: string }>(),
};
