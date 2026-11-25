import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../theme/index.css";
import { liveKeys } from "../../api/inventory";
import { MOD_COUNTS } from "../../dev/fixtures/inventory";
import { installMocks } from "../../dev/installMocks";
import { closeItemInfo, openItemInfo } from "../../state/itemInfo";
import { closeItemWindow } from "../../state/itemWindow";
import { ItemWindowHost } from "../../dev/hosts";
import { ItemInfoHost } from "./ItemInfoWindow";

async function renderWindow() {
  installMocks("");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Mod ranks normally arrive by the inventory-update event.
  client.setQueryData(liveKeys.mods, MOD_COUNTS);
  return render(
    <QueryClientProvider client={client}>
      <ItemInfoHost />
      <ItemWindowHost />
    </QueryClientProvider>,
  );
}

const serration = { uniqueName: "/Mods/Serration", name: "Serration", imageName: null, category: "Mods" };

describe("Item info window", () => {
  afterEach(() => {
    closeItemInfo();
    closeItemWindow();
    clearMocks();
  });

  it("starts at the highest owned rank and follows the chosen rank", async () => {
    await renderWindow();
    openItemInfo(serration);
    const dialog = page.getByRole("dialog", { name: "Serration" });
    await expect.element(dialog.getByText("Uncommon · Primary mod")).toBeVisible();
    await expect.element(dialog.getByText("+165% Damage")).toBeVisible();
    await expect.element(dialog.getByText("Drain at rank 10")).toBeVisible();
    await userEvent.click(dialog.getByRole("button", { name: "Rank 5 ×1" }));
    await expect.element(dialog.getByText("+90% Damage")).toBeVisible();
    await expect.element(dialog.getByRole("slider", { name: "Rank" })).toHaveValue("5");
  });

  it("lists the best drops first and shows the rest on request", async () => {
    await renderWindow();
    openItemInfo(serration);
    const drops = page.getByRole("region", { name: "Where to get it" });
    await expect.element(drops.getByText("Ceres/Hapke (Spy), Rotation C")).toBeVisible();
    await expect.element(drops.getByText("Scaldra Eradicator", { exact: false })).not.toBeInTheDocument();
    await userEvent.click(drops.getByRole("button", { name: "Show all 6" }));
    await expect.element(drops.getByText("Scaldra Eradicator", { exact: false })).toBeVisible();
  });

  it("opens the market at the chosen rank", async () => {
    await renderWindow();
    openItemInfo(serration);
    const info = page.getByRole("dialog", { name: "Serration" });
    await userEvent.click(info.getByRole("button", { name: "Rank 5 ×1" }));
    await userEvent.click(info.getByRole("button", { name: "Market" }));
    const market = page.getByRole("dialog", { name: /Serration/ }).last();
    await expect.element(market.getByRole("spinbutton", { name: "Showing rank" })).toHaveValue(5);
  });

  it("still offers the wiki for an item without details", async () => {
    await renderWindow();
    openItemInfo({ uniqueName: "/Weapons/Soma", name: "Soma", imageName: null, category: "Primary" });
    const dialog = page.getByRole("dialog", { name: "Soma" });
    await expect.element(dialog.getByRole("button", { name: "Wiki" })).toBeVisible();
    await expect.element(dialog.getByRole("heading", { name: "Stats" })).not.toBeInTheDocument();
  });
});
