import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import "../../theme/index.css";
import { resetMockStatistics } from "../../dev/fixtures/statistics";
import { installMocks } from "../../dev/installMocks";
import { ToastRegion } from "../../primitives/overlay";
import { MarketScreen } from "./MarketScreen";

async function renderScreen(search = "") {
  installMocks(search);
  resetMockStatistics();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={client}>
      <MarketScreen />
      <ToastRegion />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("tab", { name: "Trade report" }));
  return screen;
}

describe("MarketScreen statistics", () => {
  beforeEach(() => {
    // The fixtures sit on 2026-11-12; the item report filters snapshots against
    // the wall clock. Only Date is faked so the async matchers keep their timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
    localStorage.removeItem("ff-item-report-order");
  });
  afterEach(async () => {
    await cleanup();
    clearMocks();
    vi.useRealTimers();
  });

  it("shows totals and the top lists for all time", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByText("All", { exact: true }));
    await expect.element(screen.getByText("9 trades")).toBeVisible();
    await expect.element(screen.getByText("469 p")).toBeVisible();
    const types = screen.getByRole("table", { name: "Trades by type" });
    await expect.element(types.getByRole("row", { name: /Arcane/ }).getByText("-90 p")).toBeVisible();
    await expect.element(screen.getByRole("table", { name: "Sales" }).getByText("Serration (R10)")).toBeVisible();
  });

  it("shows the log with gave and received per session", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByText("Log", { exact: true }));
    const trade = screen.getByRole("article").filter({ hasText: "Friend" });
    await expect.element(trade.getByText("Trade", { exact: true })).toBeVisible();
    await expect.element(trade.getByText("Lith B1 Relic")).toBeVisible();
    await expect.element(screen.getByRole("article").filter({ hasText: "Seller1" }).getByText("45 platinum")).toBeVisible();
  });

  it("tracks an item, reorders and stops tracking after confirming", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("tab", { name: "Item report" }));
    await userEvent.fill(screen.getByRole("combobox", { name: "Track an item" }), "soma");
    await userEvent.click(page.getByRole("option", { name: /^Soma/ }).first());
    await expect.element(screen.getByRole("heading", { name: "Soma" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Move Orokin Cell up" }));
    const headings = screen.getByRole("list", { name: "Tracked items" }).getByRole("heading");
    await expect.element(headings.first()).toHaveTextContent("Orokin Cell");
    expect(localStorage.getItem("ff-item-report-order")).toContain("/Res/OrokinCell");

    await userEvent.click(screen.getByRole("button", { name: "Stop tracking Plastids" }));
    await userEvent.click(page.getByRole("dialog").getByRole("button", { name: "Delete history" }));
    await expect.element(screen.getByRole("heading", { name: "Plastids" })).not.toBeInTheDocument();
  });

  it("reads the chart with the keyboard", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("tab", { name: "Item report" }));
    const chart = screen.getByRole("slider", { name: "Orokin Cell quantity, last 30 days" });
    await expect.element(chart).toHaveAttribute("aria-valuenow", "20");
    await userEvent.click(chart);
    await userEvent.keyboard("{Home}");
    await expect.element(chart).toHaveAttribute("aria-valuenow", "0");
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(chart).toHaveAttribute("aria-valuenow", "1");
  });

  it("shows the empty states", async () => {
    const screen = await renderScreen("?scenario=empty");
    await expect.element(screen.getByText("No trade history yet.")).toBeVisible();
    await expect.element(screen.getByText("No market data available.")).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "Item report" }));
    await expect.element(screen.getByText("No items tracked yet.")).toBeVisible();
  });
});
