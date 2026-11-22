import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { SettingsScreen, type SettingsTab } from "./SettingsScreen";

type Call = { cmd: string; args: unknown };

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  await cleanup();
  clearMocks();
});

/** A backend whose settings file merges saves, like the real one. */
function setup(initial: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  let settings: Record<string, unknown> = { ...initial };
  mockWindows("main");
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "load_settings") return JSON.stringify(settings);
      if (cmd === "save_settings") settings = { ...settings, ...(JSON.parse((args as { json: string }).json) as Record<string, unknown>) };
      if (cmd === "get_warframe_window_rect") return [0, 0, 1920, 1080];
      return null;
    },
    { shouldMockEvents: true },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const find = (cmd: string) => calls.filter((c) => c.cmd === cmd);
  return { client, find, saved: () => settings };
}

function Harness() {
  const [tab, setTab] = useState<SettingsTab>("overlays");
  return <SettingsScreen tab={tab} onTabChange={setTab} />;
}

const mount = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );

/** Counts every emit of the given events. */
async function heard(...events: string[]) {
  const seen: string[] = [];
  for (const e of events)
    await listen(e, () => {
      seen.push(e);
    });
  return seen;
}

const group = (name: string) => page.getByRole("region", { name });

it("saves the switches and choices of each overlay", async () => {
  const { client, saved } = setup();
  await mount(client);
  const reward = group("Relic reward overlay");
  await expect.element(reward.getByRole("switch", { name: "Enable" })).toBeChecked();
  await reward.getByRole("combobox", { name: "Best pick" }).selectOptions("ducat");
  const pick = group("Relic pick overlay");
  await pick.getByRole("combobox", { name: "Recommend by" }).selectOptions("platinum");
  await pick.getByRole("combobox", { name: "Shown per relic" }).selectOptions("estimated");
  await group("Riven overlay").getByRole("switch", { name: "Enable" }).click();
  await vi.waitFor(() => {
    expect(saved()).toMatchObject({ overlayPriority: "ducat", relicPickPriority: "platinum", relicPickLines: "estimated", rivenEnabled: false });
  });
  await expect
    .element(group("Riven overlay").getByRole("group", { name: "Position offset" }).getByRole("spinbutton", { name: "X offset" }))
    .toBeDisabled();
});

it("shows and hides the overlays with Home unless another key is pressed in its field", async () => {
  const { client, saved } = setup();
  await mount(client);
  const key = group("All overlays").getByRole("button", { name: "Overlay key", exact: true });
  await expect.element(key).toHaveTextContent("Home");
  await key.click();
  await expect.element(key).toHaveTextContent("Press a key… (Backspace for none)");
  await userEvent.keyboard("{F8}");
  await vi.waitFor(() => {
    expect(saved()).toMatchObject({ overlayKey: "F8" });
  });
  await expect.element(key).toHaveTextContent("F8");
});

it("refuses a key that cannot be used and keeps the old one", async () => {
  const { client, saved } = setup();
  await mount(client);
  const key = group("All overlays").getByRole("button", { name: "Overlay key", exact: true });
  await key.click();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByText("That key cannot be used.", { exact: false })).toBeVisible();
  expect(saved().overlayKey).toBeUndefined();
});

it("removes the overlay key with its × or with Backspace", async () => {
  const { client, saved } = setup({ overlayKey: "F8" });
  await mount(client);
  const key = group("All overlays").getByRole("button", { name: "Overlay key", exact: true });
  await group("All overlays").getByRole("button", { name: "Remove overlay key" }).click();
  await vi.waitFor(() => {
    expect(saved()).toMatchObject({ overlayKey: "off" });
  });
  await expect.element(key).toHaveTextContent("None");
  await expect.element(group("All overlays").getByRole("button", { name: "Remove overlay key" })).not.toBeInTheDocument();

  await key.click();
  await userEvent.keyboard("{F9}");
  await vi.waitFor(() => {
    expect(saved()).toMatchObject({ overlayKey: "F9" });
  });
  await key.click();
  await userEvent.keyboard("{Backspace}");
  await vi.waitFor(() => {
    expect(saved()).toMatchObject({ overlayKey: "off" });
  });
});

it("warns that manual mode needs an overlay key", async () => {
  const { client } = setup({ overlayKey: "off", overlayManual: true });
  await mount(client);
  await expect.element(page.getByText("Manual mode needs an overlay key.", { exact: false })).toBeVisible();
});

it("cancels the capture with Escape", async () => {
  const { client, saved } = setup();
  await mount(client);
  const key = group("All overlays").getByRole("button", { name: "Overlay key", exact: true });
  await key.click();
  await userEvent.keyboard("{Escape}");
  await expect.element(key).toHaveTextContent("Home");
  expect(saved().overlayKey).toBeUndefined();
});

it("disables an overlay's choices while it is off, and hides the reward strip", async () => {
  const { client, saved } = setup({ relicPickEnabled: false });
  const seen = await heard("relic-screen");
  await mount(client);
  await expect.element(group("Relic pick overlay").getByRole("combobox", { name: "Recommend by" })).toBeDisabled();
  await group("Relic reward overlay").getByRole("switch", { name: "Enable" }).click();
  await expect.element(group("Relic reward overlay").getByRole("combobox", { name: "Best pick" })).toBeDisabled();
  expect(saved().overlayEnabled).toBe(false);
  await vi.waitFor(() => {
    expect(seen).toEqual(["relic-screen"]);
  });
});

it("saves offsets per overlay, typed or reset", async () => {
  const { client, saved } = setup({ overlayOffsets: { rivenX: 30, rivenY: 20 } });
  await mount(client);
  const pickX = group("Relic pick overlay").getByRole("spinbutton", { name: "X offset" });
  await pickX.fill("-40");
  await vi.waitFor(() => {
    expect(saved().overlayOffsets).toMatchObject({ relicPickX: -40, rivenX: 30, rivenY: 20 });
  });
  // An empty field waits; leaving it puts the saved value back.
  await pickX.fill("");
  await userEvent.tab();
  await expect.element(pickX).toHaveValue(-40);
  const riven = group("Riven overlay");
  await riven.getByRole("button", { name: "Reset" }).click();
  await vi.waitFor(() => {
    expect(saved().overlayOffsets).toMatchObject({ relicPickX: -40, rivenX: 0, rivenY: 0 });
  });
  await expect.element(riven.getByRole("button", { name: "Reset" })).toBeDisabled();
});

it("keeps the status overlay settings in their own block", async () => {
  const { client, saved } = setup({
    overlayStatus: { enabled: true, durationSeconds: 6 },
    overlayOffsets: { statusX: 10, statusY: -20 },
  });
  const seen = await heard("status-line");
  await mount(client);
  const status = group("Status");
  const enabled = status.getByRole("switch", { name: "Show status overlay" });
  await expect.element(enabled).toBeChecked();
  await expect.element(status.getByRole("slider", { name: "Display time" })).toHaveAttribute("aria-valuetext", "6 s");
  await expect.element(status.getByRole("spinbutton", { name: "X offset" })).toHaveValue(10);
  await expect.element(status.getByRole("spinbutton", { name: "Y offset" })).toHaveValue(-20);

  await enabled.click();
  await expect.element(status.getByRole("slider", { name: "Display time" })).toBeDisabled();
  await enabled.click();
  await status.getByRole("spinbutton", { name: "X offset" }).fill("30");
  await vi.waitFor(() => {
    expect(saved().overlayStatus).toMatchObject({ enabled: true, durationSeconds: 6 });
    expect(saved().overlayOffsets).toMatchObject({ statusX: 30, statusY: -20 });
  });

  await status.getByRole("button", { name: "Show preview" }).click();
  await vi.waitFor(() => {
    expect(seen).toEqual(["status-line"]);
  });
});

it("shows and hides one preview, and moves it after an offset change", async () => {
  const { client, find } = setup();
  const seen = await heard("relic-pick-preview", "relic-pick-preview-close");
  await mount(client);
  const pick = group("Relic pick overlay");
  await pick.getByRole("button", { name: "Show preview" }).click();
  await expect.element(pick.getByRole("button", { name: "Hide preview" })).toHaveAttribute("aria-pressed", "true");
  await vi.waitFor(() => {
    expect(find("show_relic_pick_window")).toHaveLength(1);
  });
  await pick.getByRole("spinbutton", { name: "Y offset" }).fill("50");
  await vi.waitFor(() => {
    expect(find("show_relic_pick_window")).toHaveLength(2);
  });
  await pick.getByRole("button", { name: "Hide preview" }).click();
  await vi.waitFor(() => {
    expect(seen).toEqual(["relic-pick-preview", "relic-pick-preview", "relic-pick-preview-close"]);
  });
});

it("shows all previews, and hides them when overlays go off or the tab closes", async () => {
  const { client, find, saved } = setup();
  const seen = await heard(
    "relic-reward-preview",
    "relic-pick-preview",
    "riven-preview",
    "relic-reward-preview-close",
    "relic-pick-preview-close",
    "riven-preview-close",
  );
  await mount(client);
  await page.getByRole("button", { name: "Show all previews" }).click();
  await vi.waitFor(() => {
    expect([...seen].sort()).toEqual(["relic-pick-preview", "relic-reward-preview", "riven-preview"]);
  });
  expect(find("show_overlay_window")[0]?.args).toEqual({ x: 0, y: 648, w: 1920, h: 324 });
  await page.getByRole("switch", { name: "Enable overlays" }).click();
  await vi.waitFor(() => {
    expect(seen.filter((e) => e.endsWith("-close")).sort()).toEqual([
      "relic-pick-preview-close",
      "relic-reward-preview-close",
      "riven-preview-close",
    ]);
  });
  expect(saved().overlaysEnabled).toBe(false);
  await expect.element(page.getByRole("button", { name: "Show all previews" })).toBeVisible();

  seen.length = 0;
  await group("Riven overlay").getByRole("button", { name: "Show preview" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("button", { name: "General" }).click();
  await vi.waitFor(() => {
    expect(seen).toEqual(["riven-preview", "riven-preview-close"]);
  });
});

it("shows the backend status line", async () => {
  const { client } = setup();
  client.setQueryData(["overlay", "status"], "Reading rewards…");
  await mount(client);
  await expect.element(group("Status").getByText("Reading rewards…", { exact: true })).toBeVisible();
});
