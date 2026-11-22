import { afterEach, describe, expect, it } from "vitest";
import { clearMocks, mockWindows } from "@tauri-apps/api/mocks";
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
});
