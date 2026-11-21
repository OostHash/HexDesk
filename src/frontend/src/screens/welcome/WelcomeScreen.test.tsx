import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
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

it("walks through appearance, privacy and explicit testing consent", async () => {
  const { client, saved } = setup();
  await render(
    <QueryClientProvider client={client}>
      <WelcomeScreen />
    </QueryClientProvider>,
  );

  await expect.element(page.getByRole("heading", { name: "Make HexDesk comfortable" })).toBeVisible();
  await page.getByRole("group", { name: "Theme" }).getByText("Light", { exact: true }).click();
  expect(localStorage.getItem("ff-theme")).toBe("light");

  await page.getByRole("button", { name: "Continue" }).click();
  await expect.element(page.getByRole("heading", { name: "Your data stays under your control" })).toBeVisible();
  await page.getByRole("combobox", { name: "Keep diagnostic logs for" }).selectOptions("4");

  await page.getByRole("button", { name: "Continue" }).click();
  const testing = page.getByRole("switch", { name: "Help test HexDesk" });
  await expect.element(testing).not.toBeChecked();
  await testing.click();
  await page.getByRole("group", { name: "Ask for feedback" }).getByText("Once per run", { exact: true }).click();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect.element(page.getByRole("heading", { name: "You are ready" })).toBeVisible();
  await page.getByRole("button", { name: "Start using HexDesk" }).click();

  await vi.waitFor(() => {
    expect(saved()).toMatchObject({
      onboardingCompleted: true,
      logRetentionDays: 4,
      testingEnabled: true,
      feedbackFrequency: "once-per-run",
    });
  });
});

it("downloads the optional small-text reader from setup", async () => {
  const { client, saved } = setup();
  await render(
    <QueryClientProvider client={client}>
      <WelcomeScreen />
    </QueryClientProvider>,
  );

  await page.getByRole("switch", { name: "Read small text more accurately" }).click();
  await vi.waitFor(() => {
    expect(saved().ocrModels).toBe(true);
  });
});
