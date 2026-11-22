import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Changelog dock in browser mode: open, search, resize by keyboard, open Inventory, narrow window — with axe. */

async function open(page: Page, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.clock.setFixedTime(new Date("2026-11-12T12:00:00Z"));
  await page.goto("/mock.html");
  await expect(page.getByRole("banner").getByText("MR 27")).toBeVisible();
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
}

const dock = (page: Page) => page.getByRole("region", { name: "Changelog" });

test("open, by keyboard", async ({ page }) => {
  await open(page);
  const toggle = dock(page).getByRole("button", { name: "Changelog", exact: true });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const list = dock(page).getByRole("list", { name: "Changes" });
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(list.getByText("12,400 → 12,650")).toBeVisible();
  await axe(page);
  await expect(page).toHaveScreenshot("changelog-open.png");
});

test("search and resize", async ({ page }) => {
  await open(page);
  await dock(page).getByRole("button", { name: "Changelog", exact: true }).click();
  await dock(page).getByRole("searchbox", { name: "Search changes" }).fill("resources");
  await expect(dock(page).getByRole("list", { name: "Changes" }).getByRole("listitem")).toHaveCount(3);
  const handle = dock(page).getByRole("separator", { name: "Changelog height" });
  const before = Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(handle).toHaveAttribute("aria-valuenow", String(before + 32));
  await axe(page);
  await expect(page).toHaveScreenshot("changelog-search.png");
});

test("a category opens Inventory on recent changes", async ({ page }) => {
  await open(page);
  await dock(page).getByRole("button", { name: "Changelog", exact: true }).click();
  await dock(page).getByRole("button", { name: "Mods" }).click();
  await expect(page.getByRole("heading", { name: "Inventory", level: 1 })).toBeAttached();
  await expect(page.getByRole("main").getByRole("button", { name: "Changed recently" })).toHaveAttribute("aria-pressed", "true");
});

test("narrow window", async ({ page }) => {
  await open(page, { width: 760, height: 700 });
  await dock(page).getByRole("button", { name: "Changelog", exact: true }).click();
  await axe(page);
  await expect(page).toHaveScreenshot("changelog-narrow.png");
});
