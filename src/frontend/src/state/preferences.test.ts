import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../theme/index.css";
import { cvdHighContrastThemes, highContrastThemes, themes } from "../theme/tokens";
import { availableChoices, PREFERENCE_KEYS, getPreferences, setPreferences, startPreferenceSync } from "./preferences";

const root = document.documentElement;

describe("preference store", () => {
  let stop: () => void = () => undefined;

  beforeEach(() => {
    localStorage.clear();
    stop = startPreferenceSync();
  });

  afterEach(() => {
    stop();
    setPreferences({ theme: "system", contrast: "system", cvd: false, density: "normal" });
    localStorage.clear();
  });

  it("writes attributes to <html> and persists to localStorage", () => {
    setPreferences({ density: "compact", cvd: true, contrast: "high" });
    expect(root.getAttribute("data-density")).toBe("compact");
    expect(root.getAttribute("data-cvd")).toBe("on");
    expect(root.getAttribute("data-resolved-contrast")).toBe("high");
    expect(localStorage.getItem(PREFERENCE_KEYS.density)).toBe("compact");
    expect(localStorage.getItem(PREFERENCE_KEYS.cvd)).toBe("true");
    expect(getPreferences().density).toBe("compact");
  });

  it("renders the light theme and high contrast", () => {
    setPreferences({ theme: "light", contrast: "normal" });
    expect(root.getAttribute("data-resolved-theme")).toBe("light");
    expect(getComputedStyle(root).getPropertyValue("--hex-bg").trim()).toBe(themes.light.bg);
    setPreferences({ contrast: "high" });
    expect(root.getAttribute("data-resolved-contrast")).toBe("high");
    expect(getComputedStyle(root).getPropertyValue("--hex-text").trim()).toBe(highContrastThemes.light.text);
    setPreferences({ cvd: true });
    expect(getComputedStyle(root).getPropertyValue("--hex-success").trim()).toBe(cvdHighContrastThemes.light.success);
    setPreferences({ theme: "dark", contrast: "normal", cvd: false });
  });

  it("applies semantic tokens through the resolved theme", () => {
    setPreferences({ theme: "dark" });
    const bg = getComputedStyle(root).getPropertyValue("--hex-bg").trim();
    expect(bg).toBe(themes.dark.bg);
  });
});

describe("available choices", () => {
  it("offers only what has a token set", () => {
    expect(availableChoices(["dark"], [])).toEqual({ themes: ["dark"], contrasts: ["normal"] });
    expect(availableChoices(["dark", "light"], [])).toEqual({ themes: ["system", "dark", "light"], contrasts: ["normal"] });
    expect(availableChoices(["dark", "light"], ["dark"]).contrasts).toEqual(["normal"]);
    expect(availableChoices(["dark", "light"], ["dark", "light"]).contrasts).toEqual(["system", "normal", "high"]);
  });
  it("matches the sets that exist now", () => {
    expect(availableChoices()).toEqual({ themes: ["system", "dark", "light"], contrasts: ["system", "normal", "high"] });
  });
});
