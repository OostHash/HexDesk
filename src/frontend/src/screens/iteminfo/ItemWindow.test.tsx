import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../theme/index.css";
import { liveKeys } from "../../api/inventory";
import { MOD_COUNTS } from "../../dev/fixtures/inventory";
import { installMocks } from "../../dev/installMocks";
import { ItemWindowHost } from "../../dev/hosts";
import { closeItemInfo, openItemInfo } from "../../state/itemInfo";

async function renderWindow() {
  installMocks("");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Mod ranks normally arrive by the inventory-update event.
  client.setQueryData(liveKeys.mods, MOD_COUNTS);
  return render(
    <QueryClientProvider client={client}>
      <ItemWindowHost />
    </QueryClientProvider>,
  );
}

const serration = { uniqueName: "/Mods/Serration", name: "Serration", imageName: null, category: "Mods" };
const dialog = (name: string) => page.getByRole("dialog", { name });

describe("Item window", () => {
  beforeEach(() => {
    localStorage.removeItem("hexdesk.itemWindow.tab");
  });
  afterEach(() => {
    closeItemInfo();
    clearMocks();
  });

  it("starts at the highest owned rank and follows the chosen rank", async () => {
    await renderWindow();
    openItemInfo(serration);
    const info = dialog("Serration");
    await expect.element(info.getByText("Uncommon · Primary mod")).toBeVisible();
    await expect.element(info.getByText("+165% Damage")).toBeVisible();
    await expect.element(info.getByText("Drain at rank 10")).toBeVisible();
    await userEvent.click(info.getByRole("button", { name: "Rank 5 ×1" }));
    await expect.element(info.getByText("+90% Damage")).toBeVisible();
    await expect.element(info.getByRole("slider", { name: "Rank" })).toHaveValue("5");
  });

  it("lists the best drops first and shows the rest on request", async () => {
    await renderWindow();
    openItemInfo(serration);
    await userEvent.click(dialog("Serration").getByRole("tab", { name: "Drops" }));
    const drops = page.getByRole("region", { name: "Where to get it" });
    await expect.element(drops.getByText("Ceres/Hapke (Spy), Rotation C")).toBeVisible();
    await expect.element(drops.getByText("Scaldra Eradicator", { exact: false })).not.toBeInTheDocument();
    await userEvent.click(drops.getByRole("button", { name: "Show all 6" }));
    await expect.element(drops.getByText("Scaldra Eradicator", { exact: false })).toBeVisible();
  });

  it("shows the market at the rank chosen on Info", async () => {
    await renderWindow();
    openItemInfo(serration);
    const window = dialog("Serration");
    await userEvent.click(window.getByRole("button", { name: "Rank 5 ×1" }));
    await userEvent.click(window.getByRole("tab", { name: "Market" }));
    await expect.element(window.getByRole("spinbutton", { name: "Showing rank" })).toHaveValue(5);
  });

  it("opens on the tab used last", async () => {
    await renderWindow();
    openItemInfo(serration);
    await userEvent.click(dialog("Serration").getByRole("tab", { name: "Drops" }));
    closeItemInfo();
    openItemInfo(serration);
    await expect.element(dialog("Serration").getByRole("tab", { name: "Drops" })).toHaveAttribute("aria-selected", "true");
  });

  it("still offers the wiki for an item without details", async () => {
    await renderWindow();
    openItemInfo({ uniqueName: "/Weapons/Soma", name: "Soma", imageName: null, category: "Primary" });
    const window = dialog("Soma");
    await expect.element(window.getByRole("button", { name: "Wiki" })).toBeVisible();
    await expect.element(window.getByRole("heading", { name: "Stats" })).not.toBeInTheDocument();
  });
});
