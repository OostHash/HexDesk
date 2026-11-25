import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../../theme/index.css";
import { addWhisper, handleTradeCompleted } from "../../../api/trading";
import { resetMockTrading } from "../../../dev/fixtures/trading";
import { installMocks } from "../../../dev/installMocks";
import { ToastRegion } from "../../../primitives/overlay";
import { closeItemWindow } from "../../../state/itemWindow";
import { ItemWindowHost } from "../../../dev/hosts";
import { MarketScreen } from "../MarketScreen";

let client: QueryClient;

async function renderScreen({ loggedIn = true } = {}) {
  installMocks();
  resetMockTrading(loggedIn);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MarketScreen />
      <ItemWindowHost />
      <ToastRegion />
    </QueryClientProvider>,
  );
}

const listings = () => page.getByRole("table", { name: "Active listings" });

describe("Trading", () => {
  beforeEach(() => {
    sessionStorage.removeItem("ff-mock-settings");
  });
  afterEach(() => {
    closeItemWindow();
    clearMocks();
  });

  it("logs in with email and password", async () => {
    const screen = await renderScreen({ loggedIn: false });
    await userEvent.fill(screen.getByRole("textbox", { name: "Email" }), "tenno@example.test");
    await userEvent.fill(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    await expect.element(screen.getByText("Invalid email or password")).toBeVisible();
    await userEvent.fill(screen.getByLabelText("Password"), "test-password");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    await expect.element(screen.getByText("Tenno", { exact: true })).toBeVisible();
    await expect.element(screen.getByRole("radio", { name: "Invisible" })).toBeChecked();
  });

  it("lists my orders without rivens and searches them", async () => {
    const screen = await renderScreen();
    await expect.element(listings().getByText("Nova Prime Set")).toBeVisible();
    await expect.element(listings().getByText("Braton Prime Barrel")).toBeVisible();
    await expect.element(listings().getByText("Rifle Riven Mod (Veiled)")).not.toBeInTheDocument();
    await expect.element(screen.getByRole("table", { name: "Riven listings" }).getByRole("row", { name: /Soma Prime Critaata/ })).toBeVisible();
    await userEvent.fill(screen.getByRole("searchbox", { name: "Search listings" }), "serr");
    await expect.element(listings().getByText(/^Serration/)).toBeVisible();
    await expect.element(listings().getByText("Nova Prime Set")).not.toBeInTheDocument();
  });

  it("hides a listing and deletes one after confirming", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Hide Nova Prime Set" }));
    await expect.element(screen.getByRole("button", { name: "Show Nova Prime Set" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Delete Braton Prime Barrel" }));
    const dialog = page.getByRole("dialog", { name: "Delete Braton Prime Barrel?" });
    await userEvent.click(dialog.getByRole("button", { name: "Delete" }));
    await expect.element(listings().getByText("Braton Prime Barrel")).not.toBeInTheDocument();
  });

  it("edits a listing in the item window", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Edit Nova Prime Set" }));
    const form = page.getByRole("form", { name: "Edit listing" });
    await userEvent.fill(form.getByRole("spinbutton", { name: "Price (platinum)" }), "199");
    await userEvent.click(form.getByRole("button", { name: "Save listing" }));
    await expect.element(page.getByText("Listing saved")).toBeVisible();
    await expect.element(listings().getByText("199p")).toBeVisible();
  });

  it("warns before switching an auction to a direct sale", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Edit Soma Prime Critaata" }));
    const form = page.getByRole("form", { name: "Edit auction" });
    await userEvent.click(form.getByText("Direct sale", { exact: true }));
    await expect.element(form.getByText(/deletes and recreates the listing/)).toBeVisible();
    await userEvent.click(form.getByRole("button", { name: "Save auction" }));
    await expect.element(page.getByText("Auction saved")).toBeVisible();
  });

  it("shows whispers, counts them as new and handles a finished sale", async () => {
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const screen = await renderScreen();
    await expect.element(listings()).toBeVisible();
    addWhisper(client, { from: "Buyer1", message: "WTB", item: "Nova Prime Set", price: 180, timestamp: "12:00" });
    await expect.element(screen.getByRole("tab", { name: "Trading (1 new)" })).toBeVisible();
    await userEvent.click(screen.getByText("Messages (1 new)"));
    const card = screen.getByRole("article").filter({ hasText: "Buyer1" });
    await expect.element(card.getByText("Nova Prime Set")).toBeVisible();
    await expect.element(screen.getByRole("tab", { name: "Trading", exact: true })).toBeVisible();

    await handleTradeCompleted(
      client,
      { withPlayer: "buyer1", tradeType: "sale", offeredItems: [{ name: "Nova Prime Blueprint", qty: 1 }] },
      new Map(),
    );
    await expect.element(card.getByText("Completed in game · closes in 5 min")).toBeVisible();
    await expect.element(card.getByText("WFM quantity 2 → 1")).toBeVisible();
    expect(write).toHaveBeenCalledWith("/w Buyer1 Nova Prime Set sold! Thank you.");

    await userEvent.click(card.getByRole("button", { name: "Revert" }));
    await expect.element(page.getByText("Listing restored")).toBeVisible();
    await userEvent.click(screen.getByText("Listings", { exact: true }));
    await expect.element(screen.getByRole("heading", { name: /^Auto-updated listings/ })).toBeVisible();
    write.mockRestore();
  });
});
