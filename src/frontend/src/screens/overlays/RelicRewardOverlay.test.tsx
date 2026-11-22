import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { nextSession, RelicRewardOverlay, skipReason } from "./RelicRewardOverlay";

afterEach(async () => {
  await cleanup();
  clearMocks();
});

/** The backend's cards for the paths the tests send. */
function backendCard(path: string) {
  const none = { vaulted: null, ducats: null, set_name: null, parts: null, built: null, complete_sets: null };
  if (path.startsWith("?:")) return { path, name: path.slice(2), unknown: true, category: null, ...none };
  if (path.endsWith("GlaivePrimeDisc")) return { path, name: "Glaive Prime Disc", unknown: false, ...none, category: "Parts", ducats: 45 };
  return {
    path,
    name: "Rhino Prime Chassis Blueprint",
    unknown: false,
    category: "Blueprints",
    vaulted: true,
    ducats: 45,
    set_name: "Rhino Prime",
    parts: [
      { path: "/Lotus/Recipes/RhinoPrimeBlueprint", name: "Rhino Prime Blueprint", needed: 1, owned: { total: 1 }, ducats: 15 },
      { path: "/Lotus/Recipes/RhinoPrimeChassisBlueprint", name: "Rhino Prime Chassis Blueprint", needed: 1, owned: { total: 0 }, ducats: 45 },
    ],
    built: { total: 0 },
    complete_sets: 0,
  };
}

function setup(settings: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const log: string[] = [];
  mockWindows("relic-overlay");
  mockIPC(
    (cmd, args) => {
      calls.push(cmd);
      if (cmd === "log_relic_fe") log.push((args as { msg: string }).msg);
      switch (cmd) {
        case "load_settings":
          return JSON.stringify(settings);
        case "get_reward_cards":
          return (args as { paths: string[] }).paths.map(backendCard);
        case "get_item_price":
          return (
            ({ "Rhino Prime Chassis Blueprint": 9, "Glaive Prime Disc": 12 } as Record<string, number>)[(args as { itemName: string }).itemName] ??
            null
          );
        case "get_current_quantities":
          return { "/Lotus/Recipes/RhinoPrimeBlueprint": 1 };
        case "get_current_crafting":
          return [];
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, calls, log };
}

const mount = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <RelicRewardOverlay />
    </QueryClientProvider>,
  );

it("draws nothing until rewards or a preview arrive", async () => {
  const { client } = setup();
  await mount(client);
  expect(page.getByRole("main", { name: "Relic rewards" }).query()).toBeNull();
});

it("shows a card per reward with prices and set parts, and marks the best pick", async () => {
  const { client } = setup({ overlayPriority: "plat" });
  await mount(client);
  await vi.waitFor(async () => {
    await emit("relic-rewards", {
      items: ["/Lotus/StoreItems/Recipes/RhinoPrimeChassisBlueprint", "/Lotus/StoreItems/Parts/GlaivePrimeDisc", "?:Mystery"],
      positions: [0.3, 0.5, 0.7],
    });
    expect(page.getByRole("article").elements()).toHaveLength(3);
  });
  const rhino = page.getByRole("article", { name: "Rhino Prime Chassis Blueprint" });
  // Price and set value: only the chassis has a price here, so both read 9p.
  await expect.element(rhino.getByText("9p").first()).toBeVisible();
  expect(rhino.getByText("9p").elements()).toHaveLength(2);
  await expect.element(rhino.getByText("Vaulted")).toBeVisible();
  await expect.element(rhino.getByRole("list", { name: "Rhino Prime parts" })).toBeVisible();
  // Glaive Prime Disc is worth most on platinum priority.
  await expect.element(page.getByRole("article", { name: "Glaive Prime Disc, best pick" })).toBeVisible();
  // Unrecognised OCR text keeps its words, marked with "?".
  await expect.element(page.getByRole("heading", { name: "? Mystery" })).toBeVisible();
});

it("marks a card whose match is uncertain", async () => {
  const { client } = setup();
  await mount(client);
  await vi.waitFor(async () => {
    await emit("relic-rewards", {
      items: ["/Lotus/StoreItems/Recipes/RhinoPrimeChassisBlueprint", "/Lotus/StoreItems/Parts/GlaivePrimeDisc"],
      positions: [0.4, 0.6],
      uncertain: [true, false],
    });
    expect(page.getByRole("article").elements()).toHaveLength(2);
  });
  const rhino = page.getByRole("article", { name: /^Rhino Prime Chassis Blueprint, uncertain/ });
  await expect.element(rhino.getByText("Uncertain")).toBeVisible();
  await expect.element(page.getByRole("article", { name: /^Glaive Prime Disc/ }).getByText("Uncertain")).not.toBeInTheDocument();
});

it("shows the preview cards, and live rewards take over", async () => {
  const { client } = setup();
  await mount(client);
  await vi.waitFor(async () => {
    await emit("relic-reward-preview", {});
    expect(page.getByRole("article").elements()).toHaveLength(4);
  });
  await expect.element(page.getByRole("article", { name: /^Rhino Prime Blueprint/ })).toBeVisible();
  await emit("relic-rewards", { items: ["/Lotus/StoreItems/Parts/GlaivePrimeDisc"], positions: [0.5] });
  await expect.element(page.getByRole("article", { name: /^Glaive Prime Disc/ })).toBeVisible();
  // A preview close does not hide live rewards.
  await emit("relic-reward-preview-close", {});
  await expect.element(page.getByRole("article", { name: /^Glaive Prime Disc/ })).toBeVisible();
});

it("hides and parks the window on empty rewards or when overlays are switched off", async () => {
  const { client, calls } = setup();
  await mount(client);
  await vi.waitFor(async () => {
    await emit("relic-rewards", { items: ["/Lotus/StoreItems/Parts/GlaivePrimeDisc"], positions: [0.5] });
    expect(page.getByRole("article").elements()).toHaveLength(1);
  });
  await emit("overlays-disabled", {});
  await expect.element(page.getByRole("main", { name: "Relic rewards" })).not.toBeInTheDocument();
  expect(calls).toContain("move_overlay_offscreen");
});

it("keeps what is shown on a duplicate or shorter read", () => {
  const live = { source: "live" as const, paths: ["a", "b"], uncertain: [] };
  expect(nextSession(live, { items: ["a", "b"], positions: [] })).toBe(live);
  expect(nextSession(live, { items: ["c"], positions: [] })).toBe(live);
  expect(nextSession(live, { items: ["a", "b", "c"], positions: [] })).toEqual({ source: "live", paths: ["a", "b", "c"], uncertain: [] });
  expect(nextSession({ source: "preview", paths: [], uncertain: [] }, { items: ["x"], positions: [], uncertain: [true] })).toEqual({
    source: "live",
    paths: ["x"],
    uncertain: [true],
  });
});

it("says in the session log why a read is skipped", () => {
  const live = { source: "live" as const, paths: ["a", "b"], uncertain: [] };
  expect(skipReason(live, { items: ["a", "b"], positions: [] })).toBe("duplicate");
  expect(skipReason(live, { items: ["c"], positions: [] })).toBe("count guard (1<=2)");
  expect(skipReason(live, { items: ["a", "b", "c"], positions: [] })).toBeNull();
  expect(skipReason({ source: "preview", paths: [], uncertain: [] }, { items: ["x"], positions: [] })).toBeNull();
});

it("writes each read to the overlay session log", async () => {
  const { client, log } = setup();
  await mount(client);
  const rewards = { items: ["/Lotus/StoreItems/Parts/GlaivePrimeDisc"], positions: [0.5] };
  await vi.waitFor(async () => {
    await emit("relic-rewards", rewards);
    expect(page.getByRole("article").elements()).toHaveLength(1);
  });
  await emit("relic-rewards", rewards);
  await vi.waitFor(() => {
    expect(log).toContain("[OV] rewards (1 items)");
    expect(log).toContain("[OV] rewards: duplicate, skipping");
  });
});
