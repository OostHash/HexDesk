import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import "../theme/index.css";
import { appKeys } from "../api/app";
import { MainNav, type NavScreen } from "./MainNav";
import { NAV_COLLAPSED_KEY } from "./navCollapsed";
import { NAV_ICONS } from "./navIcons";

const SCREENS: NavScreen[] = [
  { id: "inventory", label: "Inventory", icon: NAV_ICONS.inventory },
  { id: "market", label: "Market", icon: NAV_ICONS.market },
];

function renderNav(update: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(appKeys.update, update);
  return render(
    <QueryClientProvider client={client}>
      <MainNav screens={SCREENS} current="inventory" onSelect={() => undefined} settingsOpen={false} onOpenSettings={() => undefined} />
    </QueryClientProvider>,
  );
}

// The label text exists twice: in the item and in its tooltip. The item comes first.
const label = (screen: { getByText: (text: string) => ReturnType<typeof page.getByText> }) => screen.getByText("Inventory").first();
const tooltip = (screen: { getByText: (text: string) => ReturnType<typeof page.getByText> }) => screen.getByText("Inventory").nth(1);

const navWidth = () => document.querySelector("nav")?.getBoundingClientRect().width ?? 0;

beforeEach(async () => {
  localStorage.removeItem(NAV_COLLAPSED_KEY);
  await page.viewport(1280, 800);
});

afterEach(async () => {
  await cleanup();
});

describe("MainNav", () => {
  it("starts collapsed to icons on a wide window", async () => {
    const screen = await renderNav();
    await expect.element(screen.getByRole("button", { name: "Expand navigation" })).toBeVisible();
    await expect.element(label(screen)).not.toBeVisible();
    expect(navWidth()).toBeLessThan(100);
  });

  it("expands and collapses again from the empty space, and remembers it", async () => {
    const screen = await renderNav();
    await userEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    await expect.element(label(screen)).toBeVisible();
    expect(navWidth()).toBeGreaterThan(200);
    expect(localStorage.getItem(NAV_COLLAPSED_KEY)).toBe("expanded");

    await cleanup();
    const again = await renderNav();
    await expect.element(label(again)).toBeVisible();
    await userEvent.click(again.getByRole("button", { name: "Collapse navigation" }));
    await expect.element(label(again)).not.toBeVisible();
    expect(localStorage.getItem(NAV_COLLAPSED_KEY)).toBe("collapsed");
  });

  it("names a collapsed item in a tooltip on keyboard focus", async () => {
    const screen = await renderNav();
    await userEvent.tab();
    const item = screen.getByRole("button", { name: "Inventory" });
    await expect.element(item).toHaveFocus();
    await expect.element(screen.getByRole("tooltip", { name: "Inventory" })).toBeVisible();
    // The tooltip repeats the name, so it is not wired up as a description.
    await expect.element(item).not.toHaveAttribute("aria-describedby");
  });

  it("hides the tooltip when the label is shown", async () => {
    localStorage.setItem(NAV_COLLAPSED_KEY, "expanded");
    const screen = await renderNav();
    await userEvent.tab();
    await expect.element(screen.getByRole("button", { name: "Inventory" })).toHaveFocus();
    await expect.element(tooltip(screen)).not.toBeVisible();
  });

  it("stays icons only on a narrow window, without the toggle", async () => {
    localStorage.setItem(NAV_COLLAPSED_KEY, "expanded");
    await page.viewport(600, 800);
    const screen = await renderNav();
    await expect.element(label(screen)).not.toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Collapse navigation", includeHidden: true })).not.toBeVisible();
  });
});

describe("MainNav update", () => {
  it("marks Settings while an update waits, and names why", async () => {
    const screen = await renderNav("2.4.0");
    await expect.element(screen.getByRole("button", { name: "Settings, update available" })).toBeVisible();
  });

  it("leaves Settings plain without an update", async () => {
    const screen = await renderNav();
    await expect.element(screen.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  });
});

describe("NAV_ICONS", () => {
  it("draws every icon as a filled shape inside its 24px box", async () => {
    const screen = await render(
      <div>
        {Object.entries(NAV_ICONS).map(([name, Glyph]) => (
          <Glyph key={name} data-testid={name} />
        ))}
      </div>,
    );
    for (const name of Object.keys(NAV_ICONS)) {
      const svg = screen.getByTestId(name).element() as SVGSVGElement;
      const path = svg.querySelector("path");
      expect(path?.getAttribute("fill"), name).toBe("currentColor");
      const box = path?.getBoundingClientRect();
      const frame = svg.getBoundingClientRect();
      expect(box?.width, name).toBeGreaterThan(12);
      expect(box?.right, name).toBeLessThanOrEqual(frame.right + 0.5);
      expect(box?.bottom, name).toBeLessThanOrEqual(frame.bottom + 0.5);
    }
  });
});
