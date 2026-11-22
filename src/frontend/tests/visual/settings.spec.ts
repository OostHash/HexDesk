import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Settings in browser mode: every category, keyboard, confirmations, narrow window — with axe. */

const PRESETS = {
  presets: [
    { id: "p1", name: "Prime parts", module: "inventory", createdAt: 1, pinned: true, filters: {} },
    { id: "p2", name: "Owned mods", module: "inventory", createdAt: 2, filters: {} },
  ],
  restorePreviousFiltersOnPresetClick: true,
};

async function open(page: Page, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.clock.setFixedTime(new Date("2026-11-12T12:00:00Z"));
  // Mock settings live in sessionStorage; seed presets for the Filters tab.
  await page.addInitScript((presets) => {
    sessionStorage.setItem("ff-mock-settings", JSON.stringify({ fissureNotifications: true, filterPresets: presets }));
  }, PRESETS);
  await page.goto("/mock.html");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Settings" })).toBeVisible();
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
}

const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Settings" }).getByRole("button", { name, exact: true });

test("general", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("switch", { name: "Enable memory scanner" })).not.toBeChecked();
  await axe(page);
  await expect(page).toHaveScreenshot("settings-general.png");
});

test("memory scanner switch turns the header chip on", async ({ page }) => {
  await open(page);
  // The switch follows the settings file, a tick after the click.
  const toggle = page.getByRole("switch", { name: "Enable memory scanner" });
  await toggle.click();
  await expect(toggle).toBeChecked();
  // Settings is a screen: leave it like any other.
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Settings" })).toBeHidden();
  // Scanner runs, no game in mock mode.
  await expect(page.getByRole("banner").getByText("No Game")).toBeVisible();
});

test("overlays, offset by keyboard and previews", async ({ page }) => {
  await open(page);
  await tab(page, "Overlays").click();
  const riven = page.getByRole("region", { name: "Riven overlay" });
  const x = riven.getByRole("spinbutton", { name: "X offset" });
  await x.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(x).toHaveValue("20");
  await expect(riven.getByRole("button", { name: "Reset" })).toBeEnabled();
  await page.getByRole("button", { name: "Show all previews" }).click();
  await expect(page.getByRole("button", { name: "Hide all previews" })).toHaveAttribute("aria-pressed", "true");
  await axe(page);
  await expect(page).toHaveScreenshot("settings-overlays.png");
});

test("debugging", async ({ page }) => {
  await open(page);
  await tab(page, "Debugging").click();
  await expect(page.getByRole("group", { name: "Diagnostics export", exact: true })).toBeVisible();
  await axe(page);
  await expect(page).toHaveScreenshot("settings-debugging.png");
});

test("console, an entry opened and the export", async ({ page }) => {
  await open(page);
  await tab(page, "Console").click();
  const entries = page.getByRole("list", { name: "Log entries" });
  const failure = entries.getByRole("button", { name: /Order could not be created/ });
  await failure.click();
  await expect(entries.getByText("market.denied")).toBeVisible();
  await page.getByRole("button", { name: "Export…" }).click();
  const choose = page.getByRole("dialog", { name: "Export diagnostics" });
  await axe(page);
  await choose.getByRole("button", { name: "Export", exact: true }).click();
  await expect(choose).toBeHidden();
  await expect(page.getByText(/^Saved to .*hexdesk-diagnostics-.*\.zip$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Show in folder" })).toBeVisible();
  await axe(page);
});

test("market, logged in", async ({ page }) => {
  await open(page);
  await tab(page, "Market").click();
  const auto = page.getByRole("switch", { name: "Go invisible after a while" });
  await auto.click();
  await expect(auto).toBeChecked();
  await expect(page.getByRole("spinbutton", { name: "Minutes before going invisible" })).toBeEnabled();
  await axe(page);
  await expect(page).toHaveScreenshot("settings-market.png");
});

test("filters, by keyboard", async ({ page }) => {
  await open(page);
  // The categories are buttons in a navigator: Tab moves between them, Enter opens one.
  await tab(page, "General").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(tab(page, "Filters")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tab(page, "Filters")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("switch", { name: "Restore previous filters on active preset click" })).toBeChecked();
  await expect(page.getByRole("region", { name: "Pinned presets" }).getByText("Prime parts")).toBeVisible();
  await axe(page);
  await expect(page).toHaveScreenshot("settings-filters.png");
});

test("general: appearance", async ({ page }) => {
  await open(page);
  // Segmented radios: the input is visually hidden, its label is the target.
  await page.getByText("24h", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "24h" })).toBeChecked();
  await expect(page.getByText(/System locale/)).toBeHidden();
  await axe(page);
  await expect(page).toHaveScreenshot("settings-appearance.png");
});

test("general: notifications", async ({ page, context }) => {
  // In a browser the notification plugin asks the browser, not Tauri.
  await context.grantPermissions(["notifications"]);
  await open(page);
  const send = page.getByRole("button", { name: "Send test notification" });
  await send.scrollIntoViewIfNeeded();
  await send.click();
  await expect(page.getByText(/^Sent\./)).toBeVisible();
  // The Windows hint sits behind the "i" next to the label; focus shows it.
  await page.getByRole("button", { name: "More info" }).focus();
  await expect(page.getByRole("tooltip")).toContainText("Windows drops every notification silently");
  await axe(page);
  await expect(page).toHaveScreenshot("settings-notifications.png");
});

test("data: factory reset asks first", async ({ page }) => {
  await open(page);
  await tab(page, "Data").click();
  await page.getByRole("button", { name: "Reset everything" }).click();
  const confirm = page.getByRole("dialog", { name: "Reset HexDesk?" });
  await expect(confirm).toBeVisible();
  await axe(page);
  await expect(page).toHaveScreenshot("settings-data-reset.png");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Settings" })).toBeVisible();
});

test("narrow window", async ({ page }) => {
  await open(page, { width: 760, height: 700 });
  await axe(page);
  await expect(page).toHaveScreenshot("settings-narrow.png");
});
