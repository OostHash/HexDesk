import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
function setup(initial: { settings?: Record<string, unknown>; session?: [string, string] | null; update?: string | null } = {}) {
  const calls: Call[] = [];
  let settings: Record<string, unknown> = { ...initial.settings };
  mockWindows("main");
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "load_settings":
        return JSON.stringify(settings);
      case "save_settings":
        settings = { ...settings, ...(JSON.parse((args as { json: string }).json) as Record<string, unknown>) };
        return null;
      case "set_ocr_models":
        settings = { ...settings, ocrModels: (args as { enabled: boolean }).enabled };
        return null;
      case "wfm_get_session":
        return initial.session ?? null;
      case "get_item_list_status":
        return { count: 1200, recipe_count: 300 };
      case "get_system_locale":
        return "nl-NL";
      case "check_for_update":
        return initial.update ?? null;
      default:
        return null;
    }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const saved = () => settings;
  return { calls, client, saved };
}

function Harness({ initialTab }: { initialTab: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  return <SettingsScreen tab={tab} onTabChange={setTab} />;
}

const mount = (client: QueryClient, tab: SettingsTab = "general") =>
  render(
    <QueryClientProvider client={client}>
      <Harness initialTab={tab} />
    </QueryClientProvider>,
  );

it("lists the categories in a navigator and shows the chosen one beside it", async () => {
  const { client } = setup();
  await mount(client);
  const nav = page.getByRole("navigation", { name: "Settings" });
  await expect.element(nav.getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
  await expect.element(page.getByRole("heading", { name: "General", level: 2 })).toBeVisible();

  await nav.getByRole("button", { name: "Filters" }).click();
  await expect.element(nav.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-current", "page");
  await expect.element(page.getByRole("heading", { name: "Filters", level: 2 })).toBeVisible();
  await expect.element(page.getByRole("combobox", { name: "Counts changes from" })).toBeVisible();
});

it("checks for updates on demand and says when HexDesk is up to date", async () => {
  const { client } = setup();
  await mount(client);
  await page.getByRole("button", { name: "Check now" }).click();
  await expect.element(page.getByRole("group", { name: "Check for updates" }).getByRole("status")).toHaveTextContent("HexDesk is up to date.");
  await expect.element(page.getByRole("button", { name: "General", exact: true })).toBeVisible();
});

it("offers to install a found update and marks General until then", async () => {
  const { client, calls } = setup({ update: "2.4.0" });
  await mount(client);
  await page.getByRole("button", { name: "Check now" }).click();
  await expect.element(page.getByRole("group", { name: "Check for updates" }).getByRole("status")).toHaveTextContent("Version 2.4.0 is available.");
  await expect.element(page.getByRole("navigation", { name: "Settings" }).getByRole("button", { name: "General, update available" })).toBeVisible();
  await page.getByRole("button", { name: "Install and restart" }).click();
  await vi.waitFor(() => {
    expect(calls.map((c) => c.cmd)).toContain("install_update");
  });
});

it("turns the memory scanner on in the settings file", async () => {
  const { client, saved } = setup();
  await mount(client);
  const toggle = page.getByRole("switch", { name: "Enable memory scanner" });
  await expect.element(toggle).not.toBeChecked();
  await toggle.click();
  await expect.element(toggle).toBeChecked();
  expect(saved().memoryScannerEnabled).toBe(true);
});

it("downloads the OCR models when the player allows them", async () => {
  const { client, saved, calls } = setup();
  await mount(client);
  const toggle = page.getByRole("switch", { name: "Read small text more accurately" });
  await expect.element(toggle).not.toBeChecked();
  await toggle.click();
  await vi.waitFor(() => {
    expect(saved().ocrModels).toBe(true);
  });
  expect(calls.find((call) => call.cmd === "set_ocr_models")?.args).toEqual({ enabled: true });
  await expect.element(page.getByText("The OCR models are downloaded and in use.")).toBeVisible();
  await expect.element(toggle).toBeChecked();
});

it("stores privacy choices and can start the welcome flow again", async () => {
  const { client, saved } = setup({ settings: { onboardingCompleted: true } });
  await mount(client);

  await page.getByRole("combobox", { name: "Keep diagnostic logs for" }).selectOptions("5");
  await page.getByRole("switch", { name: "Help test HexDesk" }).click();
  await page.getByRole("group", { name: "Ask for feedback" }).getByText("Every 3 completed screen flows", { exact: true }).click();
  await page.getByRole("button", { name: "Show welcome screen again" }).click();

  await vi.waitFor(() => {
    expect(saved()).toMatchObject({
      onboardingCompleted: false,
      logRetentionDays: 5,
      testingEnabled: true,
      feedbackFrequency: "every-3-flows",
    });
  });
});

it("keeps the OCR models of an older settings file that chose ocrs", async () => {
  const { client } = setup({ settings: { ocrEngines: { title: "windows", relicList: "ocrs" } } });
  await mount(client);
  await expect.element(page.getByRole("switch", { name: "Read small text more accurately" })).toBeChecked();
});

it("no longer has a Foundry page size; it moved to the Foundry toolbar", async () => {
  const { client } = setup();
  await mount(client);
  await expect.element(page.getByRole("combobox", { name: "Items per page" })).not.toBeInTheDocument();
});

it("disables status automation while logged out", async () => {
  const { client } = setup();
  await mount(client, "market");
  await expect.element(page.getByText("Log in to warframe.market in Market → Trading to use these.")).toBeVisible();
  await expect.element(page.getByRole("switch", { name: "Go invisible on close" })).toBeDisabled();
});

it("clamps the auto-invisible minutes when the field is left", async () => {
  const { client, saved } = setup({ settings: { wfmAutoInvisible: true }, session: ["tenno", "online"] });
  await mount(client, "market");
  const field = page.getByRole("spinbutton", { name: "Minutes before going invisible" });
  await expect.element(field).toBeEnabled();
  await field.fill("900");
  await userEvent.tab();
  await expect.element(field).toHaveValue(480);
  expect(saved().wfmAutoInvisibleMins).toBe(480);
});

it("saves what Changed recently counts, defaulting to since HexDesk started", async () => {
  const { client, saved } = setup();
  await mount(client, "filters");
  const select = page.getByRole("combobox", { name: "Counts changes from" });
  await expect.element(select).toHaveValue("session");
  await select.selectOptions("Last 7 days");
  await vi.waitFor(() => {
    expect(saved().recentWindow).toBe("week");
  });
});

it("renames and deletes presets of the chosen page, keeping other pages", async () => {
  const presets = [
    { id: "a", name: "Primes", module: "inventory", createdAt: 1, filters: {} },
    { id: "b", name: "Ready", module: "foundry", createdAt: 2, filters: {} },
  ];
  const { client, saved } = setup({ settings: { filterPresets: { presets, restorePreviousFiltersOnPresetClick: false } } });
  await mount(client, "filters");
  await page.getByRole("button", { name: "Rename Primes" }).click();
  await page.getByRole("textbox", { name: "New name for Primes" }).fill("Prime parts");
  await page.getByRole("button", { name: "Save" }).click();
  await expect.element(page.getByText("Prime parts")).toBeVisible();

  await page.getByRole("button", { name: "Delete Prime parts" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect.element(page.getByText("No presets yet.")).toBeVisible();
  const stored = saved().filterPresets as { presets: Array<{ id: string }> };
  expect(stored.presets.map((p) => p.id)).toEqual(["b"]);
});

it("stores the colour-blind palette and density as preferences", async () => {
  const { client } = setup();
  await mount(client);
  await page.getByRole("switch", { name: "Colour-blind palette" }).click();
  expect(localStorage.getItem("ff-colorblind")).toBe("true");
  expect(document.documentElement.dataset.cvd).toBe("on");
  await page.getByText("Compact", { exact: true }).click();
  expect(localStorage.getItem("ff-density")).toBe("compact");
  expect(document.documentElement.dataset.density).toBe("compact");
  await page.getByRole("group", { name: "Theme" }).getByText("Light", { exact: true }).click();
  expect(localStorage.getItem("ff-theme")).toBe("light");
  expect(document.documentElement.dataset.resolvedTheme).toBe("light");
  await page.getByRole("group", { name: "Contrast" }).getByText("High", { exact: true }).click();
  expect(document.documentElement.dataset.resolvedContrast).toBe("high");
  await expect.element(page.getByText(/System locale: nl-NL/)).toBeVisible();
});

it("clears the inventory cache only after confirming", async () => {
  const { client, calls } = setup();
  client.setQueryData(["mastery"], { "/a": 30 });
  await mount(client, "data");
  await expect.element(page.getByText("1,200 items · 300 recipes cached")).toBeVisible();
  await page.getByRole("button", { name: "Clear cache" }).click();
  expect(calls.some((c) => c.cmd === "clear_cache")).toBe(false);
  await page.getByRole("dialog", { name: "Clear the inventory cache?" }).getByRole("button", { name: "Clear cache" }).click();
  await expect.element(page.getByText("Cache cleared.")).toBeVisible();
  expect(calls.some((c) => c.cmd === "clear_cache")).toBe(true);
  expect(client.getQueryData(["mastery"])).toEqual({});
});

it("refreshes the catalogue and reports the result", async () => {
  const { client } = setup();
  mockIPC((cmd) => {
    if (cmd === "fetch_item_list") return 1250;
    if (cmd === "get_item_list_status") return { count: 1250, recipe_count: 310 };
    if (cmd === "load_settings") return "{}";
    return null;
  });
  await mount(client, "data");
  await page.getByRole("button", { name: "Refresh catalogue" }).click();
  await expect.element(page.getByText("Loaded 1,250 items, 310 recipes.")).toBeVisible();
});
