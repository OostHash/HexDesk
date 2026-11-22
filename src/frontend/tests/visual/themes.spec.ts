import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Every screen in every token set except dark (the screen specs cover dark):
 * axe with colour contrast, plus a screenshot. Preferences go in before the
 * first paint, as in the app.
 */

const SETS = [
  { name: "dark-cvd", prefs: { "ff-theme": "dark", "ff-contrast": "normal", "ff-colorblind": "true" } },
  { name: "dark-high", prefs: { "ff-theme": "dark", "ff-contrast": "high", "ff-colorblind": "false" } },
  { name: "dark-high-cvd", prefs: { "ff-theme": "dark", "ff-contrast": "high", "ff-colorblind": "true" } },
  { name: "light", prefs: { "ff-theme": "light", "ff-contrast": "normal", "ff-colorblind": "false" } },
  { name: "light-cvd", prefs: { "ff-theme": "light", "ff-contrast": "normal", "ff-colorblind": "true" } },
  { name: "light-high", prefs: { "ff-theme": "light", "ff-contrast": "high", "ff-colorblind": "false" } },
  { name: "light-high-cvd", prefs: { "ff-theme": "light", "ff-contrast": "high", "ff-colorblind": "true" } },
] as const;

/** Sidebar screens, plus the kitchen sink for every primitive state. */
const VIEWS = ["Timers", "Foundry", "Relics", "Inventory", "Market", "Rivens", "kitchen-sink"] as const;

async function open(page: Page, prefs: Readonly<Record<string, string>>, view: (typeof VIEWS)[number]) {
  await page.clock.setFixedTime(new Date("2026-11-12T12:00:00Z"));
  await page.addInitScript((p) => {
    for (const [key, value] of Object.entries(p)) localStorage.setItem(key, value);
  }, prefs);
  if (view === "kitchen-sink") {
    await page.goto("/mock.html?view=kitchen-sink");
    await expect(page.getByRole("heading", { name: "Kitchen sink" })).toBeVisible();
    return;
  }
  await page.goto("/mock.html");
  await page.getByRole("button", { name: view, exact: true }).click();
  await expect(page.getByRole("button", { name: view, exact: true })).toHaveAttribute("aria-current", "page");
  // Mock data arrives in a few ticks; wait until loading placeholders are gone.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

for (const set of SETS) {
  test.describe(set.name, () => {
    for (const view of VIEWS) {
      test(view, async ({ page }) => {
        await open(page, set.prefs, view);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        expect(results.violations).toEqual([]);
        await expect(page).toHaveScreenshot(`${set.name}-${view.toLowerCase()}.png`);
      });
    }
  });
}
