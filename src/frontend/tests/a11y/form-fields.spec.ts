import { expect, test, type Page } from "@playwright/test";

/**
 * Every form field has an id or a name (Chrome DevTools: "A form field
 * element should have an id or name attribute"; it helps autofill and label
 * wiring). Checks each screen, the kitchen sink and every Settings category.
 */

const SCREENS = ["Timers", "Foundry", "Relics", "Inventory", "Market", "Rivens"];
const SETTINGS_CATEGORIES = ["General", "Overlays", "Market", "Filters", "Data", "Debugging", "Console"];

/** Form fields without id and name, described for the failure message. */
const anonymousFields = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("input, select, textarea"))
      .filter((el) => !el.id && !el.getAttribute("name"))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}[type=${el.getAttribute("type") ?? ""}] ${el.getAttribute("aria-label") ?? el.closest("label")?.textContent?.trim() ?? ""}`,
      ),
  );

test("every form field on every screen has an id or name", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-12T12:00:00Z"));
  await page.goto("/mock.html");
  const found: string[] = [];
  for (const screen of SCREENS) {
    await page.getByRole("button", { name: screen, exact: true }).click();
    await expect(page.getByRole("button", { name: screen, exact: true })).toHaveAttribute("aria-current", "page");
    found.push(...(await anonymousFields(page)).map((f) => `${screen}: ${f}`));
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const categories = page.getByRole("navigation", { name: "Settings" });
  for (const category of SETTINGS_CATEGORIES) {
    await categories.getByRole("button", { name: category, exact: true }).click();
    await expect(page.getByRole("heading", { name: category, level: 2 })).toBeVisible();
    found.push(...(await anonymousFields(page)).map((f) => `Settings ${category}: ${f}`));
  }
  expect(found).toEqual([]);
});

test("every form field on the kitchen sink has an id or name", async ({ page }) => {
  await page.goto("/mock.html?view=kitchen-sink");
  await expect(page.getByRole("heading", { name: "Kitchen sink" })).toBeVisible();
  expect(await anonymousFields(page)).toEqual([]);
});
