import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Appearance axes in browser mode: the colour-blind
 * palette, density, and Windows High Contrast (forced colors).
 */

async function open(page: Page, prefs: Record<string, string> = {}) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.clock.setFixedTime(new Date("2026-11-12T12:00:00Z"));
  await page.addInitScript((p) => {
    for (const [key, value] of Object.entries(p)) localStorage.setItem(key, value);
  }, prefs);
  await page.goto("/mock.html");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
}

const cssVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
}

test("colour-blind palette swaps status and gain/loss colours before the first paint", async ({ page }) => {
  await open(page, { "ff-colorblind": "true" });
  await expect(page.locator("html")).toHaveAttribute("data-cvd", "on");
  expect(await cssVar(page, "--ff-success")).toBe("#56b4e9");
  expect(await cssVar(page, "--ff-danger")).toBe("#e69f00");
  expect(await cssVar(page, "--ff-txn-sale")).toBe("#56b4e9");
  expect(await cssVar(page, "--ff-vaulted")).toBe("#e69f00");
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await axe(page);
  await expect(page).toHaveScreenshot("cvd-inventory.png");
});

test("density changes control heights, not text", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const categories = page.getByRole("navigation", { name: "Settings" });
  const general = categories.getByRole("button", { name: "Overlays" });
  const before = await general.evaluate((el) => ({ h: el.getBoundingClientRect().height, font: getComputedStyle(el).fontSize }));
  await page.getByRole("main").getByText("Comfortable", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
  const after = await general.evaluate((el) => ({ h: el.getBoundingClientRect().height, font: getComputedStyle(el).fontSize }));
  expect(after.h).toBe(before.h + 4);
  expect(after.font).toBe(before.font);
});

test.describe("forced colors", () => {
  test.use({ forcedColors: "active" });

  test("selected states get system colours", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const categories = page.getByRole("navigation", { name: "Settings" });
    const selectedTab = categories.getByRole("button", { name: "General" });
    const otherTab = categories.getByRole("button", { name: "Overlays" });
    const bg = (el: SVGElement | HTMLElement) => getComputedStyle(el).backgroundColor;
    expect(await selectedTab.evaluate(bg)).not.toBe(await otherTab.evaluate(bg));
    const chosen = page
      .getByRole("main")
      .locator("label", { has: page.getByRole("radio", { name: "Normal", exact: true }) })
      .first();
    expect(await chosen.evaluate(bg)).not.toBe("rgba(0, 0, 0, 0)");
    await expect(page).toHaveScreenshot("forced-colors-settings.png");
  });

  test("kitchen sink stays readable", async ({ page }) => {
    await open(page);
    await page.goto("/mock.html?view=kitchen-sink");
    await expect(page.getByRole("heading", { name: "Kitchen sink" })).toBeVisible();
    await expect(page).toHaveScreenshot("forced-colors-kitchen-sink.png", { fullPage: false });
  });
});
