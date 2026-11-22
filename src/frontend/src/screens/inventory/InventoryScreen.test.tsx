import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../theme/index.css";
import { liveKeys, masteryKeys } from "../../api/inventory";
import { CRAFTING, INVENTORY_MASTERY, MOD_COUNTS } from "../../dev/fixtures/inventory";
import { installMocks } from "../../dev/installMocks";
import { resetInventoryFilters } from "../../state/inventoryFilters";
import { InventoryScreen } from "./InventoryScreen";

async function renderScreen(search = "") {
  installMocks(search);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Pushed-only data normally arrives by the inventory-update event.
  client.setQueryData(masteryKeys.all, INVENTORY_MASTERY);
  client.setQueryData(liveKeys.mods, MOD_COUNTS);
  client.setQueryData(liveKeys.crafting, CRAFTING);
  return render(
    <QueryClientProvider client={client}>
      <InventoryScreen />
    </QueryClientProvider>,
  );
}

const search = () => page.getByRole("searchbox", { name: "Search items" });

describe("InventoryScreen", () => {
  beforeEach(() => {
    // Filters live in a window-wide store now; every test starts clean.
    resetInventoryFilters();
    localStorage.removeItem("ff-view-inventory");
    localStorage.removeItem("ff-page-size-inventory");
    sessionStorage.removeItem("ff-mock-settings");
  });
  afterEach(() => {
    clearMocks();
  });

  it("shows a category with mastery, building and zero-quantity items", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: /^Warframes/ }));
    const excalibur = screen.getByRole("article").filter({ hasText: "Excalibur" });
    await expect.element(excalibur.getByText("Mastered")).toBeVisible();
    await expect.element(screen.getByRole("article").filter({ hasText: "Rhino" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: /^Secondary/ }));
    await expect.element(screen.getByRole("article").filter({ hasText: "Lato" }).getByText("Building")).toBeVisible();
  });

  it("pages long lists, remembers the page size and starts over on new filters", async () => {
    const screen = await renderScreen();
    await expect.element(screen.getByText("Page 1 of 2 · 237 items")).toBeVisible();
    const cards = screen.getByRole("article");
    await expect.element(cards).toHaveLength(120);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await expect.poll(() => cards.elements().length).toBe(117);
    // A bigger page keeps the first item you were on in view and is remembered.
    await userEvent.click(screen.getByRole("button", { name: "View settings" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Per page" }), "240");
    await expect.poll(() => cards.elements().length).toBe(237);
    expect(localStorage.getItem("ff-page-size-inventory")).toBe("240");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Per page" }), "60");
    await expect.element(screen.getByText(/Page 1 of 4/)).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await expect.element(screen.getByText(/Page 2 of 4/)).toBeVisible();
    await userEvent.fill(search(), "e");
    await expect.element(screen.getByText(/Page 1 of/)).toBeVisible();
  });

  it("shows mod copies per rank and filters by rank", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: /^Mods/ }));
    const serration = screen.getByRole("article").filter({ hasText: "Serration" });
    await expect.element(serration.getByRole("definition").first()).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /^Rank: Any/ }));
    await userEvent.click(screen.getByRole("button", { name: "Rank 10" }));
    await expect.element(screen.getByText("2 items")).toBeVisible();
  });

  it("searches with comma-separated terms and filters owned items", async () => {
    const screen = await renderScreen();
    await userEvent.fill(search(), "ferrite, plastids");
    await expect.element(screen.getByText("2 items")).toBeVisible();
    await userEvent.fill(search(), "rhino");
    await userEvent.click(screen.getByRole("button", { name: "Owned", exact: true }));
    await expect.element(screen.getByText("No items found.")).toBeVisible();
  });

  it("shows recent changes", async () => {
    const screen = await renderScreen();
    await userEvent.fill(search(), "ferrite");
    await expect.element(screen.getByRole("article").getByText(/\+250/)).toBeVisible();
  });

  it("toggles a favourite and saves it in the settings", async () => {
    const screen = await renderScreen();
    await userEvent.fill(search(), "soma");
    await userEvent.click(screen.getByRole("button", { name: "Add Soma to the modular window" }));
    await expect.element(screen.getByRole("button", { name: "Remove Soma from the modular window" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches to the list view and remembers it", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByTitle("List", { exact: true }));
    await expect.element(screen.getByRole("table", { name: "Inventory" })).toBeVisible();
    expect(localStorage.getItem("ff-view-inventory")).toBe("list");
  });

  it("saves the current filters as a preset and clears them", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Prime", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Presets" }));
    await userEvent.click(page.getByRole("button", { name: "Save current filters" }));
    await userEvent.fill(page.getByRole("textbox", { name: "Preset name" }), "Primes");
    await userEvent.click(page.getByRole("button", { name: "Save", exact: true }));
    await expect.element(page.getByRole("button", { name: "Primes" })).toBeVisible();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await expect.element(screen.getByRole("button", { name: "Prime", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect.element(screen.getByRole("button", { name: "Restore filters" })).toBeVisible();
  });

  it("turns an active preset off with a second click", async () => {
    const screen = await renderScreen();
    const prime = screen.getByRole("button", { name: "Prime", exact: true });
    await userEvent.click(prime);
    await userEvent.click(screen.getByRole("button", { name: "Presets" }));
    await userEvent.click(page.getByRole("button", { name: "Save current filters" }));
    await userEvent.fill(page.getByRole("textbox", { name: "Preset name" }), "Primes");
    await userEvent.click(page.getByRole("button", { name: "Save", exact: true }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(prime);
    await expect.element(prime).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByRole("button", { name: "Presets" }));
    const preset = page.getByRole("button", { name: "Primes" });
    await userEvent.click(preset);
    await expect.element(prime).toHaveAttribute("aria-pressed", "true");
    // "Restore previous filters" is off by default: the second click clears the preset's filters.
    await userEvent.click(preset);
    await expect.element(prime).toHaveAttribute("aria-pressed", "false");
  });

  it("shows an empty inventory", async () => {
    const screen = await renderScreen("?scenario=empty");
    await expect.element(screen.getByText("No items found.")).toBeVisible();
  });
});
