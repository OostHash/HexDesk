import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** The consent-heavy testing step is kept visible as a visual contract. */
test("testing consent", async ({ page }) => {
  await page.goto("/mock.html?scenario=onboarding");
  await page.getByRole("button", { name: "Get started" }).click();
  for (const heading of ["Make it yours", "Your inventory", "Overlays in the game"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page.getByRole("heading", { name: "Help improve HexDesk" })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
  await expect(page).toHaveScreenshot("welcome-testing.png", { fullPage: true });
});
