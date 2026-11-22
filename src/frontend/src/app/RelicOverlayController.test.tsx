import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import { RelicOverlayController } from "./RelicOverlayController";

afterEach(async () => {
  await cleanup();
  clearMocks();
  localStorage.clear();
});

function setup(settings: Record<string, unknown> = {}) {
  const calls: Array<{ cmd: string; args: unknown }> = [];
  mockWindows("main");
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "load_settings") return JSON.stringify(settings);
      if (cmd === "get_warframe_window_rect") return [0, 0, 1920, 1080];
      return null;
    },
    { shouldMockEvents: true },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const find = (cmd: string) => calls.filter((c) => c.cmd === cmd);
  return { client, calls, find };
}

const mount = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <RelicOverlayController />
    </QueryClientProvider>,
  );

it("tells the backend the overlay switches once settings are read", async () => {
  const { client, find } = setup({ relicPickEnabled: false, overlayEnabled: false });
  await mount(client);
  await vi.waitFor(() => {
    expect(find("set_overlays_enabled")[0]?.args).toEqual({ enabled: true });
    expect(find("set_relic_pick_enabled")[0]?.args).toEqual({ enabled: false });
    expect(find("set_relic_reward_enabled")[0]?.args).toEqual({ enabled: false });
    expect(find("set_riven_enabled")[0]?.args).toEqual({ enabled: true });
    expect(find("set_overlay_manual")[0]?.args).toEqual({ enabled: false });
  });
});

it("tells the backend the overlay key, Home by default", async () => {
  const { client, find } = setup();
  await mount(client);
  await vi.waitFor(() => {
    expect(find("set_overlay_key")[0]?.args).toEqual({ vk: 0x24 });
  });
});

it("tells the backend when there is no overlay key", async () => {
  const { client, find } = setup({ overlayKey: "off" });
  await mount(client);
  await vi.waitFor(() => {
    expect(find("set_overlay_key")[0]?.args).toEqual({ vk: 0 });
  });
});

it("places the strip over the game when the reward screen opens", async () => {
  const { client, find } = setup();
  await mount(client);
  await vi.waitFor(async () => {
    await emit("relic-trigger", null);
    expect(find("show_overlay_window")[0]?.args).toEqual({ x: 0, y: 648, w: 1920, h: 324 });
  });
});

it("writes the trigger and the game window to the overlay session log", async () => {
  const { client, find } = setup();
  await mount(client);
  await vi.waitFor(async () => {
    await emit("relic-trigger", null);
    expect(find("show_overlay_window")).toHaveLength(1);
  });
  await emit("relic-rewards", { items: ["a"], positions: [0.5] });
  await vi.waitFor(() => {
    const lines = find("log_relic_fe").map((c) => (c.args as { msg: string }).msg);
    expect(lines).toContain("[APP] relic-trigger: wf(0,0 1920×1080)");
    expect(lines.some((l) => l.startsWith("[APP] relic-rewards: 1 items, overlayVisible="))).toBe(true);
  });
});

it("does nothing while the reward overlay is switched off", async () => {
  const { client, find } = setup({ overlayEnabled: false });
  await mount(client);
  await vi.waitFor(() => {
    expect(find("set_overlays_enabled")).toHaveLength(1);
  });
  await emit("relic-trigger", null);
  await new Promise((r) => setTimeout(r, 100));
  expect(find("show_overlay_window")).toHaveLength(0);
});

it("parks the window when the relic screen changes or rewards are empty", async () => {
  const { client, find } = setup();
  await mount(client);
  await vi.waitFor(async () => {
    await emit("relic-screen", true);
    expect(find("move_overlay_offscreen")).toHaveLength(1);
  });
  await emit("relic-rewards", null);
  await vi.waitFor(() => {
    expect(find("move_overlay_offscreen")).toHaveLength(2);
  });
});

it("keeps the backend status line for the header", async () => {
  const { client } = setup();
  await mount(client);
  await vi.waitFor(async () => {
    await emit("status-line", "Reading rewards…");
    expect(client.getQueryData(["overlay", "status"])).toBe("Reading rewards…");
  });
});
