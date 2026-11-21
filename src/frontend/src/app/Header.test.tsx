import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { appKeys } from "../api/app";
import { Header } from "./Header";

afterEach(async () => {
  await cleanup();
  clearMocks();
});

type Backend = { settings?: Record<string, unknown>; session?: [string, string] | null; monitoring?: boolean; reportFlows?: number };

function setup(backend: Backend = {}) {
  const calls: string[] = [];
  mockWindows("main");
  mockIPC((cmd) => {
    calls.push(cmd);
    switch (cmd) {
      case "load_settings":
        return JSON.stringify(backend.settings ?? {});
      case "wfm_get_session":
        return backend.session ?? null;
      case "get_monitor_status":
        return backend.monitoring ?? false;
      case "get_player_name":
        return "Tenno";
      case "test_report_flows":
        return backend.reportFlows ?? 0;
      case "export_test_report":
        backend.reportFlows = 0;
        return "C:/Users/Tenno/Downloads/hexdesk-test-report.zip";
      case "discard_test_report":
        backend.reportFlows = 0;
        return null;
      case "get_cache_statuses":
        return {
          worldstate: { source: "fresh", last_updated: null, warning: null },
          "drop-data": { source: "stale", last_updated: null, warning: null },
        };
      default:
        return null;
    }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenScreen = vi.fn();
  const onOpenSettings = vi.fn();
  return { calls, client, onOpenScreen, onOpenSettings };
}

const mount = ({ client, onOpenScreen, onOpenSettings }: { client: QueryClient; onOpenScreen: (id: string) => void; onOpenSettings: () => void }) =>
  render(
    <QueryClientProvider client={client}>
      <Header onOpenScreen={onOpenScreen} onOpenSettings={onOpenSettings} />
    </QueryClientProvider>,
  );

it("shows the account, and the memory scanner as OFF by default", async () => {
  const ctx = setup();
  ctx.client.setQueryData(appKeys.player, { name: null, masteryRank: 27 });
  await mount(ctx);
  await expect.element(page.getByText("MR 27")).toBeVisible();
  await expect.element(page.getByText("Memory")).toBeVisible();
  await expect.element(page.getByText("OFF")).toBeVisible();
  // OFF opens Settings.
  await page.getByRole("button", { name: /^Memory ?: OFF$/ }).click();
  expect(ctx.onOpenSettings).toHaveBeenCalledOnce();
});

it("pokes the scanner when the game is not found", async () => {
  const ctx = setup({ settings: { memoryScannerEnabled: true }, monitoring: true });
  await mount(ctx);
  const chip = page.getByRole("button", { name: /^Memory ?: No Game$/ });
  await chip.click();
  await expect.element(page.getByText("Checking…")).toBeVisible();
  expect(ctx.calls).toContain("poke_scan");
});

it("opens Market from the WFM chip when logged out", async () => {
  const ctx = setup();
  await mount(ctx);
  await page.getByRole("button", { name: /^WFM ?: Not logged in$/ }).click();
  expect(ctx.onOpenScreen).toHaveBeenCalledWith("market");
});

it("shows WFM online without an action", async () => {
  const ctx = setup({ session: ["tenno", "online"] });
  await mount(ctx);
  await expect.element(page.getByText("Online")).toBeVisible();
  expect(page.getByRole("button", { name: /WFM/ }).query()).toBeNull();
});

it("lists the data caches and refreshes them all", async () => {
  const ctx = setup();
  await mount(ctx);
  await page.getByRole("button", { name: /^Data ?: stale$/ }).click();
  const panel = page.getByRole("dialog", { name: "Data caches" });
  await expect.element(panel.getByText("Worldstate")).toBeVisible();
  await expect.element(panel.getByText("stale · never")).toBeVisible();
  await panel.getByRole("button", { name: "Refresh all data" }).click();
  await expect.element(panel.getByRole("button", { name: /Refreshing…/ })).toHaveAttribute("aria-busy", "true");
  expect(ctx.calls).toContain("refresh_all_caches");
});

it("shows no test report while nothing was marked wrong", async () => {
  const ctx = setup();
  ctx.client.setQueryData(appKeys.player, { name: null, masteryRank: 27 });
  await mount(ctx);
  await expect.element(page.getByText("MR 27")).toBeVisible();
  await vi.waitFor(() => {
    expect(ctx.calls).toContain("test_report_flows");
  });
  expect(page.getByText(/Test report/).query()).toBeNull();
});

it("exports the waiting test report only when asked", async () => {
  const ctx = setup({ reportFlows: 2 });
  await mount(ctx);
  await page.getByRole("button", { name: /Test report · 2 flows/ }).click();
  const panel = page.getByRole("dialog", { name: "Test report" });
  expect(ctx.calls).not.toContain("export_test_report");
  await panel.getByRole("button", { name: "Export to Downloads" }).click();
  await vi.waitFor(() => {
    expect(ctx.calls).toContain("export_test_report");
  });
  await expect.element(page.getByRole("button", { name: /Test report/ })).not.toBeInTheDocument();
});

it("asks before discarding the waiting test report", async () => {
  const ctx = setup({ reportFlows: 1 });
  await mount(ctx);
  await page.getByRole("button", { name: /Test report · 1 flow/ }).click();
  const panel = page.getByRole("dialog", { name: "Test report" });
  await panel.getByRole("button", { name: "Discard…" }).click();
  await expect.element(panel.getByText("Discard 1 flow without saving a report?", { exact: false })).toBeVisible();
  expect(ctx.calls).not.toContain("discard_test_report");
  await panel.getByRole("button", { name: "Discard", exact: true }).click();
  await vi.waitFor(() => {
    expect(ctx.calls).toContain("discard_test_report");
  });
});
