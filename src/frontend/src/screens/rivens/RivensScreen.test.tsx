import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import "../../theme/index.css";
import { resetMockRivens } from "../../dev/fixtures/rivens";
import { resetMockTrading } from "../../dev/fixtures/trading";
import { installMocks } from "../../dev/installMocks";
import { ToastRegion } from "../../primitives/overlay";
import { openRiven, useRivenFocus } from "../../state/navigation";
import { RivensScreen } from "./RivensScreen";

async function renderScreen({ search = "", loggedIn = true } = {}) {
  installMocks(search);
  resetMockRivens();
  resetMockTrading(loggedIn);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RivensScreen />
      <ToastRegion />
    </QueryClientProvider>,
  );
}

const weapon = () => page.getByRole("combobox", { name: "Weapon" });

async function pick(name: string, typed: string) {
  await userEvent.fill(weapon(), typed);
  await userEvent.click(page.getByRole("option", { name }));
}

describe("RivensScreen", () => {
  afterEach(async () => {
    // Unmount first: the analyzer unlistens riven-unveiled and needs the event mocks.
    await cleanup();
    clearMocks();
  });
  beforeEach(() => {
    sessionStorage.removeItem("ff-mock-settings");
  });

  it("opens on My rivens at a riven another screen asked for, once", async () => {
    openRiven("riv2");
    const screen = await renderScreen();
    await expect.element(screen.getByRole("tab", { name: "My rivens" })).toHaveAttribute("aria-selected", "true");
    const focused = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: /^Lato/ }) });
    await expect.element(focused).toHaveAttribute("aria-current", "true");
    const Probe = () => <span>focus: {useRivenFocus() ?? "none"}</span>;
    await render(<Probe />);
    await expect.element(page.getByText("focus: none")).toBeInTheDocument();
  });

  it("picks a weapon from the suggestions and analyses the roll", async () => {
    const screen = await renderScreen();
    await pick("Soma", "som");
    await userEvent.click(screen.getByRole("button", { name: "Critical Damage", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Critical Chance", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Multishot", exact: true }));
    const analysis = screen.getByRole("region", { name: "Analysis" });
    await expect.element(analysis.getByText("GREAT — sell it")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Multishot is positive; make it negative" }));
    await expect.element(analysis.getByText("Harmful").first()).toBeVisible();
  });

  it("saves a roll only with values", async () => {
    const screen = await renderScreen();
    await pick("Lato", "lat");
    await userEvent.click(screen.getByRole("button", { name: "Heat", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Save roll" }));
    await expect.element(page.getByText("Add stat values before saving.")).toBeVisible();
    await userEvent.fill(screen.getByRole("textbox", { name: "Heat value" }), "90");
    await userEvent.click(screen.getByRole("button", { name: "Save roll" }));
    await expect.element(page.getByText("Roll saved")).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: /Saved rolls \(3\/50\)/ })).toBeVisible();
  });

  it("renames, edits, compares and deletes saved rolls", async () => {
    const screen = await renderScreen();
    const name = screen.getByRole("textbox", { name: "Name of Soma · 2 Nov 2026" });
    await userEvent.fill(name, "Keeper");
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByRole("button", { name: "Compare Keeper" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Edit Keeper" }));
    const form = screen.getByRole("form", { name: "Edit Keeper" });
    await userEvent.fill(form.getByRole("textbox", { name: "Multishot value" }), "95");
    await userEvent.click(form.getByRole("button", { name: "Save changes" }));
    await expect.element(page.getByText("Roll updated")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Compare Keeper" }));
    await userEvent.click(screen.getByRole("button", { name: "Compare Soma · 5 Nov 2026" }));
    await expect.element(screen.getByRole("region", { name: "Comparison" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Delete Soma · 5 Nov 2026" }));
    await userEvent.click(page.getByRole("dialog").getByRole("button", { name: "Delete" }));
    await expect.element(screen.getByRole("heading", { name: /Saved rolls \(1\/50\)/ })).toBeVisible();
    await expect.element(screen.getByRole("region", { name: "Comparison" })).not.toBeInTheDocument();
  });

  it("lists owned rivens with computed stats and posts an auction", async () => {
    const screen = await renderScreen();
    await userEvent.click(screen.getByRole("tab", { name: "My rivens" }));
    await expect.element(screen.getByText("+102.3% Critical Damage")).toBeVisible();
    await expect.element(screen.getByText("x1.47 Damage to Grineer")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Sell Soma riven" }));
    const dialog = page.getByRole("dialog", { name: "Post riven auction" });
    await userEvent.click(dialog.getByText("Direct sale", { exact: true }));
    await userEvent.fill(dialog.getByRole("spinbutton", { name: "Selling price (platinum)" }), "250");
    await userEvent.click(dialog.getByRole("button", { name: "Post direct sale" }));
    await expect.element(page.getByText("Direct sale posted")).toBeVisible();
  });

  it("asks to log in before selling", async () => {
    const screen = await renderScreen({ loggedIn: false });
    await userEvent.click(screen.getByRole("tab", { name: "My rivens" }));
    await expect.element(screen.getByText(/to sell rivens/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Sell unrevealed Shotgun riven" }));
    await expect.element(page.getByText("Log in to warframe.market first")).toBeVisible();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });
});
