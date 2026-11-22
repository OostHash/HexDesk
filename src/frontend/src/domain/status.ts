/** Header status chips: what each state means in words. */

export type ChipState = "online" | "warn" | "offline" | "disabled";
export type ChipStatus = { state: ChipState; detail: string; hint: string };

export type MemoryInput = {
  /** Setting memoryScannerEnabled. */
  enabled: boolean;
  /** get_monitor_status. */
  monitoring: boolean;
  /** inventory-update warframe_running. */
  gameRunning: boolean;
  /** A poke_scan was sent less than 3 s ago. */
  checking: boolean;
};

/** How long "Checking…" shows after poking the scanner. */
export const POKE_MS = 3000;

export function memoryStatus({ enabled, monitoring, gameRunning, checking }: MemoryInput): ChipStatus & { canPoke: boolean } {
  if (!enabled) return { state: "disabled", detail: "OFF", hint: "Memory scanner disabled — enable it in Settings", canPoke: false };
  if (!monitoring) return { state: "offline", detail: "Idle", hint: "Memory scanner is starting", canPoke: false };
  if (gameRunning) return { state: "online", detail: "Scanning", hint: "Warframe detected — scanning memory", canPoke: false };
  return { state: "offline", detail: checking ? "Checking…" : "No Game", hint: "Click to check for Warframe again", canPoke: !checking };
}

export function wfmStatus(loggedIn: boolean): ChipStatus {
  return loggedIn
    ? { state: "online", detail: "Online", hint: "Logged in to warframe.market" }
    : { state: "offline", detail: "Not logged in", hint: "Not logged in to warframe.market — click to open Trading" };
}
