import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Relic reward overlay window in browser mode (?window=overlay): preview cards
 * and live rewards at a 1080p game width — with axe. The window is
 * transparent over the game, so colour contrast cannot be judged here.
 */

async function open(page: Page) {
  await page.setViewportSize({ width: 1920, height: 420 });
  await page.goto("/mock.html?window=overlay");
  await page.waitForFunction(() => "__TAURI_INTERNALS__" in window);
}

/** Emits a backend event through the mocked IPC. */
async function emit(page: Page, event: string, payload: unknown) {
  await page.evaluate(
    ([e, p]) =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(
        "plugin:event|emit",
        { event: e, payload: p },
      ),
    [event, payload] as const,
  );
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .disableRules(["color-contrast"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test("preview", async ({ page }) => {
  await open(page);
  await expect(async () => {
    await emit(page, "relic-reward-preview", {});
    await expect(page.getByRole("article")).toHaveCount(4, { timeout: 500 });
  }).toPass();
  await expect(page.getByRole("article", { name: "Rhino Prime Blueprint, best pick" })).toBeVisible();
  await axe(page);
  await expect(page).toHaveScreenshot("relic-overlay-preview.png");
});

test("live rewards", async ({ page }) => {
  await open(page);
  const rewards = {
    items: [
      "/Lotus/StoreItems/Types/Recipes/WarframeRecipes/RhinoPrimeChassisBlueprint",
      "/Lotus/StoreItems/Weapons/Tenno/Melee/Glaive/PrimeGlaive/PrimeGlaiveDisc",
      "?:Spira Prime Pouch",
    ],
    positions: [0.36, 0.5, 0.64],
  };
  await expect(async () => {
    await emit(page, "relic-rewards", rewards);
    await expect(page.getByRole("article")).toHaveCount(3, { timeout: 500 });
  }).toPass();
  await expect(page.getByRole("article", { name: /^Rhino Prime Chassis Blueprint/ }).getByText("3 of 4 parts")).toBeVisible();
  await expect(page.getByRole("heading", { name: "? Spira Prime Pouch" })).toBeVisible();
  await axe(page);
  await expect(page).toHaveScreenshot("relic-overlay-live.png");
});
