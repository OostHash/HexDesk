import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { PREVIEW_PICK } from "../../domain/relicPick";
import { RelicPickOverlay } from "./RelicPickOverlay";

afterEach(async () => {
  await cleanup();
  clearMocks();
});

function setup(settings: Record<string, unknown> = {}) {
  const calls: Array<{ cmd: string; args: unknown }> = [];
  mockWindows("relic-pick-overlay");
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "load_settings") return JSON.stringify(settings);
      return null;
    },
    { shouldMockEvents: true },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, calls };
}

const mount = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <RelicPickOverlay />
    </QueryClientProvider>,
  );

const open = async () => {
  await vi.waitFor(async () => {
    await emit("relic-pick-open", PREVIEW_PICK);
    expect(page.getByRole("main", { name: "Relic pick" }).query()).not.toBeNull();
  });
};

it("takes the mouse itself, so the cursor shows over it", async () => {
  const { client, calls } = setup();
  await mount(client);
  await open();
  await page.getByRole("button", { name: "Close relic pick" }).hover();
  expect(calls.some((c) => c.cmd === "plugin:window|set_ignore_cursor_events")).toBe(false);
});

it("ranks the relics for the priority and lists their rewards", async () => {
  const { client } = setup({ relicPickPriority: "ducat" });
  await mount(client);
  await open();
  await expect.element(page.getByRole("heading", { name: "All Eras Fissure" })).toBeVisible();
  const order = () => [...document.querySelectorAll("ol[aria-label='Recommended relics'] h2")].map((h) => h.textContent);
  await vi.waitFor(() => {
    expect(order()).toEqual(["2× Meso N1 Intact", "1× Axi R4 Intact", "3× Lith S1 Intact"]);
  });
  // The ranking score is the headline, with what it means.
  const meso = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "2× Meso N1 Intact" }) })
    .first();
  await expect.element(meso.getByText("Best")).toBeVisible();
  await expect.element(meso.getByText("ducats per run, on average")).toBeVisible();
  const rows = page.getByRole("list", { name: "Meso N1 rewards" }).getByRole("listitem");
  await expect.element(rows).toHaveLength(6);
  // Drop chance with its rarity, both values, and new items marked.
  expect(rows.first().element().textContent).toMatch(/^Nyx Prime Neuroptics Blueprint[\d.]+% drop chance, Rare30p100 ducatsNew$/);
});

it("shows the estimate line instead of rewards when asked", async () => {
  const { client } = setup({ relicPickLines: "estimated" });
  await mount(client);
  await open();
  await expect.element(page.getByText("5p · 20 ducats · 3/6 new")).toBeVisible();
  expect(page.getByRole("list", { name: "Axi R4 rewards" }).query()).toBeNull();
});

it("clears the view without suspending WebView2 and tells the backend", async () => {
  const { client, calls } = setup();
  await mount(client);
  await open();
  await page.getByRole("button", { name: "Close relic pick" }).click();
  await expect.element(page.getByRole("main", { name: "Relic pick" })).not.toBeInTheDocument();
  expect(calls.some((c) => c.cmd === "plugin:window|hide")).toBe(false);
  expect(calls.some((c) => c.cmd === "overlay_closed")).toBe(true);
});

it("confirms each view it draws to the backend", async () => {
  const { client, calls } = setup({ relicPickPriority: "ducat" });
  await mount(client);
  await vi.waitFor(async () => {
    await emit("relic-pick-open", { ...PREVIEW_PICK, view: 7 });
    expect(calls.some((c) => c.cmd === "overlay_rendered")).toBe(true);
  });
  const rendered = calls.find((c) => c.cmd === "overlay_rendered");
  expect(rendered?.args).toEqual({
    overlay: "relic_pick",
    view: 7,
    summary: "ALL: Meso N1 intact x2, Axi R4 intact x1, Lith S1 intact x3",
  });
});

it("shows the preview, which live data replaces", async () => {
  const { client } = setup();
  await mount(client);
  await vi.waitFor(async () => {
    await emit("relic-pick-preview", {});
    expect(page.getByRole("main", { name: "Relic pick" }).query()).not.toBeNull();
  });
  await emit("relic-pick-open", { era: "NEO", relics: [] });
  await expect.element(page.getByText("No Neo relics in inventory")).toBeVisible();
  await emit("relic-pick-preview-close", {});
  await expect.element(page.getByText("No Neo relics in inventory")).toBeVisible();
});

it("parks a closed preview without suspending WebView2", async () => {
  const { client, calls } = setup();
  await mount(client);
  await emit("relic-pick-preview", {});
  await expect.element(page.getByRole("main", { name: "Relic pick" })).toBeVisible();
  await emit("relic-pick-preview-close", {});
  await expect.element(page.getByRole("main", { name: "Relic pick" })).not.toBeInTheDocument();
  expect(calls.some((c) => c.cmd === "park_relic_pick_window")).toBe(true);
  expect(calls.some((c) => c.cmd === "plugin:window|hide")).toBe(false);
});

it("does not call an unconfirmed relic an inventory recommendation", async () => {
  const { client } = setup();
  await mount(client);
  await emit("relic-pick-open", {
    era: "NEO",
    relics: [{ ...PREVIEW_PICK.relics[0], on_screen: false }],
  });
  await expect.element(page.getByText("No Neo relics confirmed on screen")).toBeVisible();
});
