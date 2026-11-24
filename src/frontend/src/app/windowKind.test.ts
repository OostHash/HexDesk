import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockWindows } from "@tauri-apps/api/mocks";
import { isOverlayLocation } from "../state/preferenceSchema";
import { resolveWindowKind } from "./windowKind";

const at = (search: string, hash = "") => ({ search, hash });

describe("resolveWindowKind", () => {
  afterEach(() => {
    clearMocks();
  });

  it("is main without markers and without Tauri", () => {
    expect(resolveWindowKind(at(""))).toBe("main");
  });

  it.each([
    ["?overlay", "overlay"],
    ["?modular", "modular"],
    ["?changelog", "changelog"],
    ["?rivenoverlay", "riven-overlay"],
    ["?relicpickoverlay", "relic-pick-overlay"],
    ["?overlaystatus", "overlay-status"],
  ] as const)("reads query marker %s", (search, kind) => {
    expect(resolveWindowKind(at(search))).toBe(kind);
  });

  it("reads hash markers", () => {
    expect(resolveWindowKind(at("", "#rivenoverlay"))).toBe("riven-overlay");
  });

  it("falls back to the Tauri window label", () => {
    mockWindows("relic-pick-overlay");
    expect(resolveWindowKind(at(""))).toBe("relic-pick-overlay");
  });

  it("ignores unknown Tauri labels", () => {
    mockWindows("something-else");
    expect(resolveWindowKind(at(""))).toBe("main");
  });

  // The pre-paint script picks the overlay theme from the URL alone; it must
  // agree with the window kinds that are overlays.
  it.each(["?overlay", "?modular", "?changelog", "?rivenoverlay", "?relicpickoverlay", "?overlaystatus"])(
    "treats %s as an overlay exactly when its window kind is one",
    (search) => {
      const kind = resolveWindowKind(at(search));
      const overlay = kind === "overlay" || kind === "riven-overlay" || kind === "relic-pick-overlay" || kind === "overlay-status";
      expect(isOverlayLocation(at(search))).toBe(overlay);
      expect(isOverlayLocation(at("", search.replace("?", "#")))).toBe(overlay);
    },
  );
});
