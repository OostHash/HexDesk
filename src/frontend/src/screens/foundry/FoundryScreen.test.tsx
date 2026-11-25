import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../theme/index.css";
import { liveKeys, masteryKeys } from "../../api/inventory";
import { FOUNDRY_CRAFTING, FOUNDRY_FORMA, FOUNDRY_MASTERY, FOUNDRY_SHARDS } from "../../dev/fixtures/foundry";
import { installMocks } from "../../dev/installMocks";
import { FoundryScreen } from "./FoundryScreen";

async function renderScreen(search = "") {
  installMocks(search);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Pushed-only data normally arrives by the inventory-update event.
  client.setQueryData(masteryKeys.all, FOUNDRY_MASTERY);
  client.setQueryData(liveKeys.crafting, FOUNDRY_CRAFTING);
  client.setQueryData(liveKeys.shards, FOUNDRY_SHARDS);
  client.setQueryData(liveKeys.forma, FOUNDRY_FORMA);
  return render(
    <QueryClientProvider client={client}>
      <FoundryScreen />
    </QueryClientProvider>,
  );
}

const search = () => page.getByRole("searchbox", { name: "Search recipes" });
const card = (name: string) => page.getByRole("article").filter({ has: page.getByRole("heading", { name: `${name} — show recipe` }) });

describe("FoundryScreen — equipment", () => {
  beforeEach(() => {
    localStorage.removeItem("ff-view-foundry");
    localStorage.removeItem("ff-recipes-foundry");
    localStorage.removeItem("ff-page-size-foundry");
    localStorage.removeItem("ff-sort-foundry");
    sessionStorage.removeItem("ff-mock-settings");
  });
  afterEach(() => {
    clearMocks();
  });

  it("shows part statuses, relics and item badges on the cards", async () => {
    await renderScreen();
    const excalibur = card("Excalibur Prime");
    const parts = excalibur.getByRole("list", { name: "Parts of Excalibur Prime" });
    await expect.element(parts.getByRole("listitem").filter({ hasText: "Neuroptics" }).getByText("Blueprint", { exact: true })).toBeVisible();
    await expect.element(parts.getByRole("listitem").filter({ hasText: "Systems" }).getByText(/Relic/)).toBeVisible();
    await expect.element(excalibur.getByText("Vaulted")).toBeVisible();

    await expect.element(card("Braton Prime").getByText("Ready to build")).toBeVisible();
    // A–Z puts these on page 2 of the fixture.
    await userEvent.fill(search(), "volt, rhino, forma");
    const volt = card("Volt");
    await expect.element(volt.getByText("Mastered")).toBeVisible();
    await expect.element(volt.getByText("Forma ×3")).toBeVisible();
    await expect.element(volt.getByText(/Shards 3\/5/)).toBeVisible();
    await expect.element(card("Rhino").getByText("Subsumed")).toBeVisible();
    await expect.element(card("Forma").getByText("Building")).toBeVisible();
  });

  it("filters ready items across all pages", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Ready to build", exact: true }));
    await expect.element(screen.getByText(/^1 item · /)).toBeVisible();
    await expect.element(card("Braton Prime")).toBeVisible();
  });

  it("shows what is building with the status pill", async () => {
    const screen = await renderScreen();
    const status = screen.getByRole("group", { name: "Status" });
    await userEvent.click(status.getByRole("button", { name: /^Building/ }));
    await expect.element(screen.getByText(/^1 item · /)).toBeVisible();
    await expect.element(card("Forma")).toBeVisible();
    await userEvent.click(status.getByRole("button", { name: /^All/ }));
    await expect.element(screen.getByText("Page 1 of 2", { exact: false })).toBeVisible();
  });

  it("shows the collected progress of the open category", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("navigation", { name: "Foundry" }).getByRole("button", { name: /^Warframes/ }));
    await expect.element(screen.getByText(/ · \d+ \/ 4 collected \(\d+%\)$/)).toBeVisible();
  });

  it("hides the recipes on the cards and remembers it", async () => {
    const screen = await renderScreen();
    const excalibur = card("Excalibur Prime");
    await expect.element(excalibur.getByRole("list", { name: "Parts of Excalibur Prime" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "View settings" }));
    await userEvent.click(screen.getByRole("switch", { name: "Recipes" }));
    await expect.element(excalibur.getByRole("list", { name: "Parts of Excalibur Prime" })).not.toBeInTheDocument();
    await expect.element(card("Braton Prime").getByText("Ready to build")).toBeVisible();
    expect(localStorage.getItem("ff-recipes-foundry")).toBe("off");
  });

  it("sorts the items and remembers the order", async () => {
    const screen = await renderScreen();
    const headings = screen.getByRole("article").getByRole("heading");
    await expect.element(headings.first()).toBeVisible();
    const firstName = () => headings.first().element().textContent;
    const before = firstName();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "name-desc");
    await expect.poll(firstName).not.toBe(before);
    expect(localStorage.getItem("ff-sort-foundry")).toBe("name-desc");
  });

  it("picks the page size in the toolbar and remembers it", async () => {
    const screen = await renderScreen();
    await expect.element(screen.getByText("Page 1 of 2", { exact: false })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "View settings" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Per page" }), "60");
    await expect.element(screen.getByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
    expect(localStorage.getItem("ff-page-size-foundry")).toBe("60");
  });

  it("searches, picks categories and pages", async () => {
    const screen = await renderScreen();
    await expect.element(screen.getByText("Page 1 of 2", { exact: false })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await expect.element(screen.getByText("Page 2 of 2", { exact: false })).toBeVisible();
    await userEvent.fill(search(), "excalibur, braton");
    await expect.element(screen.getByText(/^4 items · /)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /^Melee/ }));
    await expect.element(search()).toHaveValue("");
    await expect.element(screen.getByText(/^28 items · /)).toBeVisible();
  });

  it("opens the recipe with the tree and the shopping list", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: /^Excalibur Prime — show recipe/ }));
    const dialog = page.getByRole("dialog", { name: /Excalibur Prime/ });
    await expect.element(dialog).toBeVisible();
    const tree = dialog.getByRole("treegrid", { name: "Recipe of Excalibur Prime" });
    await expect.element(tree.getByRole("row", { name: /Excalibur Prime Systems/ }).first()).toBeVisible();
    await expect.element(tree.getByText("14 / 20 · −6")).toBeVisible();

    await userEvent.click(dialog.getByRole("tab", { name: "What I need" }));
    const table = dialog.getByRole("table", { name: "Missing for Excalibur Prime" });
    await expect.element(table.getByRole("row", { name: /Plastids/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
  });

  it("explains Lich weapons instead of a recipe", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: /^Kuva Bramma — show recipe/ }));
    await expect.element(page.getByRole("dialog").getByText(/converting a Kuva Lich/)).toBeVisible();
  });

  it("tracks an item and saves it in the settings", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Track Braton Prime" }));
    await expect.element(screen.getByRole("button", { name: "Stop tracking Braton Prime" })).toHaveAttribute("aria-pressed", "true");
    expect(sessionStorage.getItem("ff-mock-settings")).toContain("/Foundry/BratonPrime");
  });

  it("switches to the list view and remembers it", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByTitle("List", { exact: true }));
    await expect.element(screen.getByRole("table", { name: "Foundry" })).toBeVisible();
    expect(localStorage.getItem("ff-view-foundry")).toBe("list");
  });

  it("shows the empty and error states", async () => {
    const empty = await renderScreen("?scenario=empty");
    await expect.element(empty.getByText("No recipes loaded.")).toBeVisible();
    await empty.unmount();
    clearMocks();
    const failed = await renderScreen("?scenario=error");
    await expect.element(failed.getByText("Could not load the recipes.")).toBeVisible();
  });
});
