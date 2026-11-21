import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import type { LogEntry } from "../../domain/console";
import { ConsoleTab } from "./ConsoleTab";

afterEach(async () => {
  await cleanup();
  clearMocks();
});

const entry = (id: number, extra: Partial<LogEntry>): LogEntry => ({
  id,
  time: `2026-11-18T15:03:${String(id).padStart(2, "0")}.000+01:00`,
  level: "info",
  source: "scanner",
  code: null,
  message: `Entry ${String(id)}`,
  fields: {},
  causes: [],
  op: null,
  repeat: null,
  ...extra,
});

const RECENT: LogEntry[] = [
  entry(1, { message: "Warframe process found", fields: { pid: "18244" } }),
  entry(2, { level: "debug", message: "Candidate found", op: 12 }),
  entry(3, {
    level: "warn",
    message: "Account blob not found: no candidate could be read",
    code: "scanner.parse",
    fields: { candidates: "2" },
    causes: ['candidate 1: required section "XPInfo" is missing'],
    op: 12,
  }),
  entry(4, { source: "market", message: "Top-items ranking refreshed" }),
];

function mount(entries: LogEntry[] = RECENT, calls: Array<{ cmd: string; args: unknown }> = []) {
  mockWindows("main");
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "get_recent_logs") return entries;
      if (cmd === "get_capture") return new Uint8Array([0x42, 0x4d]).buffer;
      return null;
    },
    { shouldMockEvents: true },
  );
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ConsoleTab />
    </QueryClientProvider>,
  );
}

const list = () => page.getByRole("list", { name: "Log entries" });

it("shows readable entries, newest first, and hides debug until asked", async () => {
  await mount();
  await expect.element(list().getByText("Top-items ranking refreshed")).toBeVisible();
  await expect.element(list().getByText("Candidate found")).not.toBeInTheDocument();
  const items = list().getByRole("listitem");
  await expect.element(items.first().getByText("Top-items ranking refreshed")).toBeVisible();
  await page.getByRole("checkbox", { name: "Debug" }).click();
  await expect.element(list().getByText("Candidate found")).toBeVisible();
});

it("shows the reason behind a failure when an entry is opened", async () => {
  await mount();
  const failure = list().getByRole("button", { name: /Account blob not found/ });
  await expect.element(failure).toHaveAttribute("aria-expanded", "false");
  await failure.click();
  await expect.element(list().getByText("scanner.parse")).toBeVisible();
  await expect.element(list().getByText('candidate 1: required section "XPInfo" is missing')).toBeVisible();
  await expect.element(list().getByRole("button", { name: "Copy line" })).toBeVisible();
});

it("filters on one or more sources and on one operation", async () => {
  await mount();
  await page.getByRole("button", { name: "market", exact: true }).click();
  await expect.element(list().getByText("Warframe process found")).not.toBeInTheDocument();
  await expect.element(list().getByText("Top-items ranking refreshed")).toBeVisible();

  await page.getByRole("button", { name: "scanner", exact: true }).click();
  await expect.element(list().getByText("Warframe process found")).toBeVisible();
  await expect.element(list().getByText("Top-items ranking refreshed")).toBeVisible();

  await page.getByRole("button", { name: "All sources" }).click();
  await expect.element(page.getByRole("button", { name: "market", exact: true })).toHaveAttribute("aria-pressed", "false");
  await list().getByRole("button", { name: "Show only operation #12" }).first().click();
  // An operation shows all its steps, debug included.
  await expect.element(list().getByText("Candidate found")).toBeVisible();
  await expect.element(list().getByText("Warframe process found")).not.toBeInTheDocument();
  await page.getByRole("button", { name: /Operation #12/ }).click();
  await expect.element(list().getByText("Warframe process found")).toBeVisible();
});

it("adds new entries live", async () => {
  await mount();
  await expect.element(list().getByText("Top-items ranking refreshed")).toBeVisible();
  await emit("diag-entry", entry(5, { level: "error", source: "updater", message: "Update check failed", code: "updater.network" }));
  await expect.element(list().getByRole("listitem").first().getByText("Update check failed")).toBeVisible();
  await expect.element(page.getByText("4 of 5 entries")).toBeVisible();
});

it("saves the capture choice and shows a saved capture in the entry details", async () => {
  const calls: Array<{ cmd: string; args: unknown }> = [];
  await mount([entry(1, { source: "overlay", message: "Overlay key capture saved", fields: { capture: "overlay-key-1.bmp" } })], calls);
  await page.getByRole("checkbox", { name: "Save what OCR reads on screen" }).click();
  await expect
    .poll(() => calls.some((c) => c.cmd === "save_settings" && (c.args as { json: string }).json.includes('"overlayKeyCapture":true')))
    .toBe(true);
  await list()
    .getByRole("button", { name: /Overlay key capture saved/ })
    .click();
  await expect.element(page.getByRole("img", { name: "Screen capture given to OCR" })).toBeInTheDocument();
  expect(calls.find((c) => c.cmd === "get_capture")?.args).toEqual({ name: "overlay-key-1.bmp" });
});

it("removes logs only after confirmation", async () => {
  const calls: Array<{ cmd: string; args: unknown }> = [];
  await mount(RECENT, calls);

  await page.getByRole("button", { name: "Remove logs" }).click();
  expect(calls.some((call) => call.cmd === "remove_logs")).toBe(false);
  await page.getByRole("dialog", { name: "Remove logs and captures?" }).getByRole("button", { name: "Remove logs" }).click();

  await expect.poll(() => calls.some((call) => call.cmd === "remove_logs")).toBe(true);
  await expect.element(page.getByText("Logs and captures removed. Logging continues for this session.")).toBeVisible();
});
