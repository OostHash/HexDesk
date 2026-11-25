import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../theme/index.css";
import { liveKeys } from "../../api/inventory";
import { MOD_COUNTS } from "../../dev/fixtures/inventory";
import { resetMockTrading } from "../../dev/fixtures/trading";
import { installMocks } from "../../dev/installMocks";
import { ToastRegion } from "../../primitives/overlay";
import { closeItemWindow } from "../../state/itemWindow";
import { ItemWindowHost } from "../../dev/hosts";
import { InventoryScreen } from "./InventoryScreen";

async function renderScreen(search = "") {
  installMocks(search);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Mod ranks normally arrive by the inventory-update event.
  client.setQueryData(liveKeys.mods, MOD_COUNTS);
  const screen = await render(
    <QueryClientProvider client={client}>
      <InventoryScreen />
      <ItemWindowHost />
      <ToastRegion />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("tab", { name: "Prime Sets" }));
  return screen;
}

const setCard = (name: string) => page.getByRole("article").filter({ has: page.getByRole("heading", { name: `${name} — show set orders` }) });

describe("Inventory: Prime Sets and Mods & Arcanes", () => {
  beforeEach(() => {
    sessionStorage.removeItem("ff-mock-settings");
    resetMockTrading();
  });
  afterEach(() => {
    closeItemWindow();
    clearMocks();
  });

  it("shows prime sets with completion, dupes and prices", async () => {
    const screen = await renderScreen();
    const nova = setCard("Nova Prime");
    await expect.element(nova.getByText("Complete")).toBeVisible();
    await expect.element(nova.getByText("Dupes")).toBeVisible();
    await expect.element(nova.getByText(/p set$/)).toBeVisible();
    await expect.element(setCard("Braton Prime").getByText("1 of 5 parts")).toBeVisible();
    await expect.element(screen.getByText(/10 total · 10 shown$/)).toBeVisible();
    await expect.element(nova.getByText("As set")).toBeVisible();
    await expect.element(setCard("Braton Prime").getByText("Set when complete")).toBeVisible();
    await expect.element(setCard("Braton Prime").getByText(/^1 relic you own drop it: Neo S1 Flawless$/)).toBeInTheDocument();
  });

  it("filters sets by category, the built item and search", async () => {
    const screen = await renderScreen();
    const nav = screen.getByRole("navigation", { name: "Prime set categories" });
    // The fixture's primes are all Primary weapons.
    await userEvent.click(nav.getByRole("button", { name: /^Warframes/ }));
    await expect.element(screen.getByText("No sets match.")).toBeVisible();
    await userEvent.click(nav.getByRole("button", { name: /^Primary/ }));
    await expect.element(setCard("Nova Prime")).toBeVisible();
    await userEvent.click(nav.getByRole("button", { name: /^All/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    await userEvent.click(page.getByRole("group", { name: "Built item" }).getByRole("button", { name: "Owned" }));
    await expect.element(screen.getByText(/ 1 shown$/)).toBeVisible();
    await expect.element(setCard("Paris Prime")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Clear filters" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.fill(screen.getByRole("searchbox", { name: "Search sets" }), "ash, loki");
    await expect.element(screen.getByText(/ 2 shown$/)).toBeVisible();
  });

  it("opens a part with its order book and copies a whisper", async () => {
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await renderScreen();
    await userEvent.click(setCard("Nova Prime").getByRole("button", { name: /^Barrel/ }));
    const dialog = page.getByRole("dialog", { name: /Nova Prime Barrel/ });
    const sellers = dialog.getByRole("table", { name: "Sellers of Nova Prime Barrel" });
    await expect.element(sellers.getByRole("row").nth(1)).toBeVisible();
    await userEvent.click(dialog.getByRole("button", { name: "Copy whisper to Ordis_Fan" }));
    await expect.element(page.getByText("Whisper to Ordis_Fan copied")).toBeVisible();
    expect(write).toHaveBeenCalledWith('/w Ordis_Fan Hi! I want to buy: "Nova Prime Barrel" for 16 platinum. (warframe.market)');
    write.mockRestore();
  });

  it("posts an order at a matched price", async () => {
    await renderScreen();
    await userEvent.click(setCard("Nova Prime").getByRole("button", { name: /^Nova Prime — show set orders/ }));
    const dialog = page.getByRole("dialog", { name: /Nova Prime Set/ });
    await userEvent.click(dialog.getByRole("button", { name: /^Match/ }).first());
    const form = dialog.getByRole("form", { name: "New order" });
    const price = form.getByRole("spinbutton", { name: "Price (platinum)" });
    await expect.element(price).not.toHaveValue(0);
    await userEvent.click(form.getByText("Hidden", { exact: true }));
    await userEvent.click(form.getByRole("button", { name: "Post order" }));
    await expect.element(page.getByText("Order posted as hidden")).toBeVisible();
    await expect.element(form).not.toBeInTheDocument();
  });

  it("shows mods with copies per rank and opens the market from the price", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("tab", { name: "Mods & Arcanes" }));
    const nav = screen.getByRole("navigation", { name: "Mod and arcane categories" });
    await userEvent.click(nav.getByRole("button", { name: /^All arcanes/ }));
    await expect.element(screen.getByText("2 shown", { exact: false })).toBeVisible();
    await userEvent.click(nav.getByRole("button", { name: /^All mods/ }));
    await expect.element(screen.getByText("Blind Rage")).toBeVisible();
    await expect.element(screen.getByText("Arcane Energize")).not.toBeInTheDocument();
    await userEvent.click(nav.getByRole("button", { name: /^Primary/ }));
    await expect.element(screen.getByText("Rank 10 (max)").first()).toBeVisible();
    await expect.element(screen.getByText("Rifle · Madurai")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /^Serration: .* platinum, open the market$/ }));
    const dialog = page.getByRole("dialog", { name: /Serration/ });
    await expect.element(dialog.getByRole("spinbutton", { name: "Showing rank" })).toHaveValue(0);
  });

  it("shows the empty state", async () => {
    const screen = await renderScreen("?scenario=empty");
    await expect.element(screen.getByText("No sets match.")).toBeVisible();
  });
});
