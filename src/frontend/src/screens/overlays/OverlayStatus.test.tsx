import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { OverlayStatus } from "./OverlayStatus";

afterEach(async () => {
  await cleanup();
  clearMocks();
});

function setup(settings: Record<string, unknown> = {}) {
  const calls: string[] = [];
  mockWindows("overlay-status");
  mockIPC(
    (cmd) => {
      calls.push(cmd);
      if (cmd === "load_settings") return JSON.stringify(settings);
      return null;
    },
    { shouldMockEvents: true },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { calls, client };
}

const mount = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <OverlayStatus />
    </QueryClientProvider>,
  );

it("shows backend status without taking the mouse", async () => {
  const { calls, client } = setup();
  await mount(client);

  await vi.waitFor(async () => {
    await emit("status-line", "Reading relic list…");
    expect(page.getByRole("status").query()).not.toBeNull();
  });
  await expect.element(page.getByRole("status")).toHaveTextContent("Reading relic list…");
  expect(calls).toContain("plugin:window|set_ignore_cursor_events");
  expect(calls).toContain("show_overlay_status_window");
});

it("stays hidden when the status overlay is turned off", async () => {
  const { calls, client } = setup({ overlayStatus: { enabled: false } });
  await mount(client);
  await vi.waitFor(async () => {
    await emit("status-line", "Reading relic list…");
    expect(calls).toContain("plugin:window|set_ignore_cursor_events");
  });
  expect(page.getByRole("status").query()).toBeNull();
  expect(calls).not.toContain("show_overlay_status_window");
});

it("shows the scoped testing prompt even when ordinary status is off", async () => {
  const { client } = setup({ overlayStatus: { enabled: false } });
  await mount(client);

  await vi.waitFor(async () => {
    await emit("testing-feedback", { visible: true, flow: "reward" });
    expect(page.getByLabelText("Testing feedback").query()).not.toBeNull();
  });
  await expect.element(page.getByText("Was the Relic flow result correct?")).toBeVisible();
  await expect.element(page.getByText("Page Up", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Page Down", { exact: true })).toBeVisible();

  await emit("testing-feedback", { visible: false });
  await vi.waitFor(() => {
    expect(page.getByLabelText("Testing feedback").query()).toBeNull();
  });
});
