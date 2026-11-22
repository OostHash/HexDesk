import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { ModularDock } from "./ModularDock";

afterEach(async () => {
  await cleanup();
  clearMocks();
});

function setup(initial: Record<string, unknown>, saveGate?: Promise<void>) {
  let settings: Record<string, unknown> = { ...initial };
  const calls: Array<{ cmd: string; args: unknown }> = [];
  mockWindows("main");
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "load_settings") return JSON.stringify(settings);
    if (cmd === "plugin:window|get_all_windows") return ["main"];
    if (cmd === "save_settings") {
      settings = { ...settings, ...(JSON.parse((args as { json: string }).json) as Record<string, unknown>) };
      return saveGate ?? null;
    }
    return null;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, calls, saved: () => settings };
}

const mount = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <ModularDock />
    </QueryClientProvider>,
  );

it("saves the docked width when resizing ends", async () => {
  // The docked width is capped by the window (window − 582 px).
  await page.viewport(1280, 800);
  const { client, saved } = setup({ modularWidth: 240 });
  await mount(client);
  const handle = page.getByRole("separator", { name: "Modular window width" });
  await expect.element(handle).toHaveAttribute("aria-valuenow", "240");
  // The test container has no height, so focus the handle instead of clicking it.
  (handle.element() as HTMLElement).focus();
  // The handle sits on the left edge: arrow left makes the panel wider.
  await userEvent.keyboard("{ArrowLeft}");
  await vi.waitFor(() => {
    expect(saved().modularWidth).toBe(248);
  });
});

it("keeps the committed width while its setting is still being saved", async () => {
  await page.viewport(1280, 800);
  let finishSave!: () => void;
  const saveGate = new Promise<void>((resolve) => {
    finishSave = () => {
      resolve();
    };
  });
  const { client } = setup({ modularWidth: 240 }, saveGate);
  await mount(client);
  const handle = page.getByRole("separator", { name: "Modular window width" });
  (handle.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(handle).toHaveAttribute("aria-valuenow", "248");
  finishSave();
  await expect.element(handle).toHaveAttribute("aria-valuenow", "248");
});

it("collapses to a rail and remembers the choice", async () => {
  const { client, saved } = setup({});
  await mount(client);
  await page.getByRole("button", { name: "Collapse modular window" }).click();
  await expect.element(page.getByRole("button", { name: "Expand modular window" })).toBeVisible();
  await vi.waitFor(() => {
    expect(saved().modularCollapsed).toBe(true);
  });
  // The vertical title is part of the rail button, so clicking it opens the panel.
  await page.getByText("Modular window", { exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Collapse modular window" })).toBeVisible();
  await vi.waitFor(() => {
    expect(saved().modularCollapsed).toBe(false);
  });
});

it("pops out into its own window and hides the docked panel", async () => {
  const { client, calls, saved } = setup({});
  await mount(client);
  await page.getByRole("button", { name: "Open in its own window" }).click();
  await expect.element(page.getByRole("complementary", { name: "Modular window" })).not.toBeInTheDocument();
  expect(saved().modularPopout).toBe(true);
  await vi.waitFor(() => {
    const create = calls.find((c) => c.cmd === "plugin:webview|create_webview_window");
    expect(create?.args).toMatchObject({ options: { label: "modular-popout", url: "index.html#modular" } });
  });
});
