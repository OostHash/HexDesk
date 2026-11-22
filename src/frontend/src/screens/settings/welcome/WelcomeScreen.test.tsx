import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { WelcomeScreen } from "./WelcomeScreen";

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  await cleanup();
  clearMocks();
});

function setup(initial: Record<string, unknown> = { onboardingCompleted: false }) {
  let settings = { ...initial };
  mockWindows("main");
  mockIPC((cmd, args) => {
    if (cmd === "load_settings") return JSON.stringify(settings);
    if (cmd === "save_settings") {
      settings = { ...settings, ...(JSON.parse((args as { json: string }).json) as Record<string, unknown>) };
      return null;
    }
    if (cmd === "set_ocr_models") {
      settings = { ...settings, ocrModels: (args as { enabled: boolean }).enabled };
      return null;
    }
    return null;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, saved: () => settings };
}

const mount = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <WelcomeScreen />
    </QueryClientProvider>,
  );

it("opens on the welcome page, then walks through appearance, overlays, testing and the community", async () => {
  const { client, saved } = setup();
  await mount(client);

  await expect.element(page.getByRole("heading", { name: "Welcome to HexDesk" })).toBeVisible();
  await page.getByRole("button", { name: "Get started" }).click();

  await expect.element(page.getByRole("heading", { name: "Make it yours" })).toBeVisible();
  await page.getByRole("group", { name: "Theme" }).getByText("Light", { exact: true }).click();
  expect(localStorage.getItem("ff-theme")).toBe("light");

  await page.getByRole("button", { name: "Continue" }).click();
  await expect.element(page.getByRole("heading", { name: "Your inventory" })).toBeVisible();
  const scanner = page.getByRole("switch", { name: "Enable memory scanner" });
  await expect.element(scanner).not.toBeChecked();
  await scanner.click();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect.element(page.getByRole("heading", { name: "Overlays in the game" })).toBeVisible();
  await page.getByRole("button", { name: "Overlay key", exact: true }).click();
  await userEvent.keyboard("{F8}");
  await page.getByRole("switch", { name: "Manual mode" }).click();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect.element(page.getByRole("heading", { name: "Help improve HexDesk" })).toBeVisible();
  const testing = page.getByRole("switch", { name: "Help test HexDesk" });
  await expect.element(testing).not.toBeChecked();
  await testing.click();
  await page.getByRole("combobox", { name: "Ask for feedback" }).selectOptions("once-per-run");
  await page.getByRole("button", { name: "Correct key" }).click();
  await userEvent.keyboard("{PageDown}");
  await expect.element(page.getByText("Page Down is already the wrong key.")).toBeVisible();
  await page.getByRole("button", { name: "Wrong key" }).click();
  await userEvent.keyboard("{End}");
  // The how-it-works steps name the chosen key.
  await expect.element(page.getByRole("list").getByText("End", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect.element(page.getByRole("heading", { name: "Join the HexDesk community" })).toBeVisible();
  await expect.element(page.getByRole("img", { name: "QR code for the HexDesk Discord invite" })).toBeVisible();
  await page.getByRole("button", { name: "Start using HexDesk" }).click();

  await vi.waitFor(() => {
    expect(saved()).toMatchObject({
      onboardingCompleted: true,
      memoryScannerEnabled: true,
      overlayKey: "F8",
      overlayManual: true,
      testingEnabled: true,
      feedbackFrequency: "once-per-run",
      testingCorrectKey: "PageUp",
      testingWrongKey: "End",
    });
  });
});

it("downloads the optional small-text reader from setup", async () => {
  const { client, saved } = setup();
  await mount(client);

  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("switch", { name: "Read small text more accurately" }).click();
  await vi.waitFor(() => {
    expect(saved().ocrModels).toBe(true);
  });
});
