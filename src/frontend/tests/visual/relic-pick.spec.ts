import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Relic pick window in browser mode (?window=relic-pick-overlay): preview and
 * the estimate view, keyboard close — with axe. The window is transparent
 * over the game, so colour contrast cannot be judged here.
 */

async function open(page: Page, settings: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 460, height: 900 });
  await page.addInitScript((s) => {
    sessionStorage.setItem("ff-mock-settings", JSON.stringify(s));
  }, settings);
  await page.goto("/mock.html?window=relic-pick-overlay");
  await page.waitForFunction(() => "__TAURI_INTERNALS__" in window);
  await expect(async () => {
    await page.evaluate(() =>
      (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(
        "plugin:event|emit",
        {
          event: "relic-pick-preview",
          payload: {},
        },
      ),
    );
    await expect(page.getByRole("main", { name: "Relic pick" })).toBeVisible({ timeout: 500 });
  }).toPass();
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .disableRules(["color-contrast"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test("preview, all rewards", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("list", { name: "Axi R4 rewards" }).getByRole("listitem")).toHaveCount(6);
  await axe(page);
  await expect(page).toHaveScreenshot("relic-pick-all.png");
});

test("estimated value, platinum priority", async ({ page }) => {
  await open(page, { relicPickLines: "estimated", relicPickPriority: "platinum" });
  await expect(page.getByText("5p · 20 ducats · 3/6 new")).toBeVisible();
  await axe(page);
  await expect(page).toHaveScreenshot("relic-pick-estimated.png");
});

test("close by keyboard", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Close relic pick" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main", { name: "Relic pick" })).toBeHidden();
});
