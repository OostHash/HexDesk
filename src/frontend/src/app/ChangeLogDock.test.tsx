import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emit, listen } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { changeKeys } from "../api/inventory";
import type { ChangeEntry } from "../domain/inventory";
import { getInventoryFilters, resetInventoryFilters } from "../state/inventoryFilters";
import { ChangeLogDock } from "./ChangeLogDock";
import { ChangeLogPopoutPage } from "./ChangeLogPopoutPage";

afterEach(async () => {
  await cleanup();
  clearMocks();
  resetInventoryFilters();
});

const LOG: ChangeEntry[] = [
  { id: 2, unique_name: "/Res/Ferrite", item_name: "Ferrite", old_qty: 100, new_qty: 150, delta: 50, timestamp: 2000 },
  { id: 1, unique_name: "/Mods/Serration", item_name: "Serration", old_qty: 2, new_qty: 1, delta: -1, timestamp: 1000, rank: 10 },
];

function setup(saved: unknown[] = []) {
  mockWindows("main");
  mockIPC(
    (cmd, args) => {
      switch (cmd) {
        case "save_settings":
          saved.push(JSON.parse((args as { json: string }).json));
          return null;
        case "get_change_log":
          return LOG;
        case "get_all_items":
          return [
            { unique_name: "/Res/Ferrite", name: "Ferrite", category: "Resources" },
            { unique_name: "/Mods/Serration", name: "Serration", category: "Mods" },
          ];
        case "load_settings":
          return JSON.stringify({ clockFormat: "24h" });
        case "get_system_locale":
          return "en-GB";
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenInventory = vi.fn();
  return { client, onOpenInventory };
}

const mount = ({ client, onOpenInventory }: ReturnType<typeof setup>) =>
  render(
    <QueryClientProvider client={client}>
      <ChangeLogDock onOpenInventory={onOpenInventory} />
    </QueryClientProvider>,
  );

const toggle = () => page.getByRole("button", { name: "Changelog", exact: true });

it("opens and lists every change with its range, rank and amount", async () => {
  const ctx = setup();
  await mount(ctx);
  await expect.element(toggle()).toHaveAttribute("aria-expanded", "false");
  await toggle().click();
  await expect.element(toggle()).toHaveAttribute("aria-expanded", "true");
  const list = page.getByRole("list", { name: "Changes" });
  await expect.element(list.getByText("100 → 150")).toBeVisible();
  await expect.element(list.getByText("R10")).toBeVisible();
  await expect.element(list.getByText("Decreased by")).toBeInTheDocument();
});

it("searches on name and category", async () => {
  const ctx = setup();
  await mount(ctx);
  await toggle().click();
  await page.getByRole("searchbox", { name: "Search changes" }).fill("mods");
  await expect.element(page.getByRole("list", { name: "Changes" }).getByRole("listitem")).toHaveLength(1);
  await page.getByRole("searchbox", { name: "Search changes" }).fill("nothing");
  await expect.element(page.getByText("No matching changes.")).toBeVisible();
});

it("treats the loaded log as history, and a new batch as an arrival with a feed", async () => {
  const ctx = setup();
  await mount(ctx);
  // Let the dock render the loaded log (open it, then close it again).
  await toggle().click();
  await expect.element(page.getByRole("list", { name: "Changes" }).getByRole("listitem")).toHaveLength(2);
  await toggle().click();
  expect(page.getByText("+1").query()).toBeNull();

  ctx.client.setQueryData<ChangeEntry[]>(changeKeys.all, (prev) => [
    { id: 3, unique_name: "/Res/Ferrite", item_name: "Ferrite", old_qty: 150, new_qty: 175, delta: 25, timestamp: 3000 },
    ...(prev ?? []),
  ]);
  await expect.element(page.getByRole("status")).toHaveTextContent("+1 increased");
  // Collapsed: the new change runs as a full feed row, with its category and range.
  await expect.element(page.getByText("Increased by")).toBeInTheDocument();
  await expect.element(page.getByText("150 → 175")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Resources" })).toBeVisible();
});

it("opens the wiki menu with a right-click on a change", async () => {
  const ctx = setup();
  await mount(ctx);
  await toggle().click();
  await page.getByRole("list", { name: "Changes" }).getByText("100 → 150").click({ button: "right" });
  await expect.element(page.getByRole("menuitem", { name: "Open wiki" })).toBeVisible();
});

it("opens Inventory on an item, a category or recent changes", async () => {
  const ctx = setup();
  await mount(ctx);
  await toggle().click();
  const list = page.getByRole("list", { name: "Changes" });
  await list.getByRole("button", { name: "Serration" }).click();
  expect(getInventoryFilters().search).toBe("Serration");
  expect(ctx.onOpenInventory).toHaveBeenCalledTimes(1);

  await list.getByRole("button", { name: "Mods" }).click();
  expect(getInventoryFilters()).toMatchObject({ filterRecent: true, category: "Mods", search: "" });

  // All text on the bar opens recent changes in Inventory, the scan time included.
  await page.getByText(/last scan/).click();
  expect(getInventoryFilters()).toMatchObject({ filterRecent: true, category: "all" });
  expect(ctx.onOpenInventory).toHaveBeenCalledTimes(3);
});

it("opens Inventory when the pop-out asks for it", async () => {
  const ctx = setup();
  await mount(ctx);
  await expect.element(toggle()).toBeVisible();
  await emit("changelog-open-inventory", { item: "Ferrite" });
  await expect.poll(() => getInventoryFilters().search).toBe("Ferrite");
  expect(ctx.onOpenInventory).toHaveBeenCalledTimes(1);
  await emit("changelog-open-inventory", { category: "Mods" });
  await expect.poll(() => getInventoryFilters()).toMatchObject({ filterRecent: true, category: "Mods" });
});

it("saves the pop-out choice from the header button", async () => {
  const saved: unknown[] = [];
  const ctx = setup(saved);
  await mount(ctx);
  await page.getByRole("button", { name: "Open in its own window" }).click();
  await expect.poll(() => saved).toContainEqual({ changelogPopout: true });
});

it("the pop-out page lists changes and sends clicks to the main window", async () => {
  const ctx = setup();
  const asked: unknown[] = [];
  await listen("changelog-open-inventory", (e) => {
    asked.push(e.payload);
  });
  await render(
    <QueryClientProvider client={ctx.client}>
      <ChangeLogPopoutPage />
    </QueryClientProvider>,
  );
  const list = page.getByRole("list", { name: "Changes" });
  await list.getByRole("button", { name: "Serration" }).click();
  await list.getByRole("button", { name: "Resources" }).click();
  await page.getByRole("button", { name: "Show in Inventory" }).click();
  await expect.poll(() => asked).toEqual([{ item: "Serration" }, { category: "Resources" }, {}]);
  expect(getInventoryFilters().search).toBe("");
});
