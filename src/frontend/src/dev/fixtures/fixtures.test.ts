import { afterEach, describe, expect, it } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";
import { invoke } from "../../api/invoke";
import { installMocks } from "../installMocks";
import { readScenario } from "./scenario";

describe("mock IPC", () => {
  afterEach(() => {
    clearMocks();
    sessionStorage.clear();
  });

  it("answers commands with the default fixture", async () => {
    installMocks("");
    const ws = await invoke("fetch_worldstate");
    expect(ws.fissures?.length).toBeGreaterThan(0);
  });

  it("serves the empty fixture", async () => {
    installMocks("?scenario=empty");
    await expect(invoke("fetch_worldstate")).resolves.toEqual({});
  });

  it("rejects in the error scenario", async () => {
    installMocks("?scenario=error");
    await expect(invoke("fetch_worldstate")).rejects.toThrow(/scenario=error/);
  });

  it.each(["error", "loading"])("still loads settings in the %s scenario, so the main window shows", async (scenario) => {
    installMocks(`?scenario=${scenario}`);
    await expect(invoke("load_settings")).resolves.toContain("timerFavorites");
  });

  it("builds reward cards for known items and marks the rest unrecognized", async () => {
    installMocks("");
    const cards = await invoke("get_reward_cards", {
      paths: ["/Lotus/StoreItems/Types/Recipes/WarframeRecipes/RhinoPrimeChassisBlueprint", "?:Spira Prime Pouch"],
    });
    expect(cards.map((c) => [c.name, c.unknown, c.set_name])).toEqual([
      ["Rhino Prime Chassis Blueprint", false, "Rhino Prime"],
      ["Spira Prime Pouch", true, null],
    ]);
  });

  it("serves fresh-install settings in the onboarding scenario", async () => {
    installMocks("?scenario=onboarding");
    const settings = JSON.parse(await invoke("load_settings")) as Record<string, unknown>;
    expect(settings).toMatchObject({
      onboardingCompleted: false,
      testingEnabled: false,
      logRetentionDays: 1,
      feedbackFrequency: "every-flow",
    });
  });

  it("falls back to default for unknown scenarios", () => {
    expect(readScenario("?scenario=bogus")).toBe("default");
  });
});
