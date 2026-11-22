import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_VIEW, type RivenView } from "../../src/domain/rivenOverlay";

/**
 * Riven overlay window in browser mode (?window=riven-overlay): the backend
 * is not there, so the test sends the view itself — the preview and a
 * comparison, keyboard close — with axe. The window is transparent over the
 * game, so colour contrast cannot be judged here.
 */

async function open(page: Page, view: RivenView) {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/mock.html?window=riven-overlay");
  await page.waitForFunction(() => "__TAURI_INTERNALS__" in window);
  await expect(page.getByRole("main", { name: "Riven check" })).toBeVisible();
  await expect(async () => {
    await page.evaluate(
      (payload) =>
        (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke(
          "plugin:event|emit",
          {
            event: "riven-view",
            payload,
          },
        ),
      view,
    );
    await expect(page.getByText("Scanning stats…")).toBeHidden({ timeout: 500 });
  }).toPass();
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .disableRules(["color-contrast"])
    .analyze();
  expect(results.violations).toEqual([]);
}

const comparison: RivenView = {
  ...(PREVIEW_VIEW as Extract<RivenView, { kind: "result" }>),
  preview: false,
  isComparison: true,
  originalStats: [
    { name: "Multi-shot", value: "+90%", positive: true },
    { name: "Zoom", value: "-30%", positive: false },
  ],
};

test("preview", async ({ page }) => {
  await open(page, PREVIEW_VIEW);
  await expect(page.getByRole("region", { name: "Rolled stats" }).getByRole("listitem")).toHaveCount(4);
  await axe(page);
  await expect(page).toHaveScreenshot("riven-preview.png");
});

test("comparison", async ({ page }) => {
  await open(page, comparison);
  await expect(page.getByRole("region", { name: "Original roll" }).getByRole("listitem")).toHaveCount(2);
  await axe(page);
  await expect(page).toHaveScreenshot("riven-comparison.png");
});

test("close by keyboard", async ({ page }) => {
  await open(page, PREVIEW_VIEW);
  await page.getByRole("button", { name: "Close riven check" }).focus();
  await page.keyboard.press("Enter");
  // A closed preview leaves the window empty until the next check.
  await expect(page.getByRole("heading", { name: "Tenora Prime" })).toBeHidden();
});
