import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { SettingsScreen, type SettingsTab } from "./SettingsScreen";

type Call = { cmd: string; args: unknown };

const SAVED = "C:/Users/Tenno/Downloads/hexdesk-diagnostics-2026-11-18-150312.zip";

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  await cleanup();
  clearMocks();
});

/** A backend that exports to SAVED; `overrides` answer single commands. */
function setup(overrides: Record<string, (args: unknown) => unknown> = {}) {
  const calls: Call[] = [];
  mockWindows("main");
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    const override = overrides[cmd];
    if (override) return override(args);
    if (cmd === "load_settings") return "{}";
    if (cmd === "export_diagnostics") return SAVED;
    return null;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const find = (cmd: string) => calls.filter((c) => c.cmd === cmd);
  return { client, find };
}

function Harness() {
  const [tab, setTab] = useState<SettingsTab>("debugging");
  return <SettingsScreen tab={tab} onTabChange={setTab} />;
}

const mount = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );

const row = (name: string) => page.getByRole("group", { name, exact: true });
const exportDialog = () => page.getByRole("dialog", { name: "Export diagnostics" });

/** "Export…" asks what to include; the dialog's Export writes the zip. */
async function exportWith(uncheck: string[] = []) {
  await row("Diagnostics export").getByRole("button", { name: "Export…" }).click();
  for (const label of uncheck) await exportDialog().getByText(label, { exact: true }).click();
  await exportDialog().getByRole("button", { name: "Export", exact: true }).click();
}

it("exports diagnostics and then offers to show the zip in its folder", async () => {
  const { client, find } = setup();
  await mount(client);
  const exportRow = row("Diagnostics export");
  await expect.element(exportRow.getByRole("button", { name: "Show in folder" })).not.toBeInTheDocument();
  await exportWith();
  await expect.element(exportDialog()).not.toBeInTheDocument();
  await expect.element(exportRow.getByRole("status")).toHaveTextContent(`Saved to ${SAVED}`);
  await exportRow.getByRole("button", { name: "Show in folder" }).click();
  await vi.waitFor(() => {
    expect(find("show_diagnostics_export").map((c) => c.args)).toEqual([{ path: SAVED }]);
  });
});

it("shows why an export failed", async () => {
  const { client } = setup({ export_diagnostics: () => Promise.reject(new Error("the zip file could not be created")) });
  await mount(client);
  await exportWith();
  // The dialog stays open with the reason, so the user can try again.
  await expect.element(exportDialog().getByRole("alert")).toHaveTextContent("Export failed: the zip file could not be created");
});

it("exports only the parts the user keeps checked", async () => {
  const { client, find } = setup();
  await mount(client);
  await exportWith(["System information", /* settings stay */ "Log files"]);
  await vi.waitFor(() => {
    expect(find("export_diagnostics").map((c) => c.args)).toEqual([{ parts: { system: false, settings: true, activity: true, logs: false } }]);
  });
});

it("cannot export with every part left out", async () => {
  const { client } = setup();
  await mount(client);
  await row("Diagnostics export").getByRole("button", { name: "Export…" }).click();
  for (const label of ["System information", "Settings", "Activity", "Log files"]) {
    await exportDialog().getByText(label, { exact: true }).click();
  }
  await expect.element(exportDialog().getByRole("button", { name: "Export", exact: true })).toBeDisabled();
});

it("has none of the old FrameForge debug tools", async () => {
  const { client } = setup();
  await mount(client);
  await expect.element(row("Diagnostics export")).toBeVisible();
  for (const old of [
    "Overlay log",
    "Relic captures",
    "Inventory snapshots",
    "Memory probe",
    "Raw memory record",
    "Unmatched paths",
    "Incoming batch",
  ]) {
    await expect.element(row(old)).not.toBeInTheDocument();
  }
});

it("keeps the developer pages under Debugging", async () => {
  const { client } = setup();
  await mount(client);
  await expect.element(row("Kitchen sink").getByRole("button", { name: "Open" })).toBeVisible();
  await expect.element(row("Tokens").getByRole("button", { name: "Open" })).toBeVisible();
});

it("simulates an available update and clears it again", async () => {
  const { client } = setup();
  await mount(client);
  await row("Simulate update").getByRole("button", { name: "Simulate" }).click();
  await expect.element(page.getByRole("navigation", { name: "Settings" }).getByRole("button", { name: "General, update available" })).toBeVisible();
  await row("Simulate update").getByRole("button", { name: "Clear" }).click();
  await expect.element(page.getByRole("navigation", { name: "Settings" }).getByRole("button", { name: "General", exact: true })).toBeVisible();
});

it("lists owned items whose icon is missing", async () => {
  const { client } = setup({
    get_all_items: () => [
      { unique_name: "/Res/Credits", name: "Credits", category: "Resources", image_name: null },
      { unique_name: "/Res/Spare", name: "Spare Part", category: "Resources", image_name: null },
    ],
    get_current_quantities: () => ({ "/Res/Credits": 1000, "/Res/Mystery": 3 }),
  });
  await mount(client);
  await row("Check item icons").getByRole("button", { name: "Owned items" }).click();
  await expect.element(row("Check item icons").getByRole("status")).toHaveTextContent("2 owned items checked, 2 with a problem.");
  // Spare Part is not owned, so it is not checked.
  await expect.element(page.getByRole("region", { name: "No image name in the catalogue" }).getByText("Credits")).toBeVisible();
  await expect.element(page.getByText("Spare Part")).not.toBeInTheDocument();
  await expect.element(page.getByRole("region", { name: "Owned but not in the catalogue" }).getByText("Mystery")).toBeVisible();
});
