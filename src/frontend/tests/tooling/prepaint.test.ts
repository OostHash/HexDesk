import { describe, expect, it } from "vitest";
import { prepaintScript } from "../../src/state/prepaint.ts";
import { PREFERENCE_KEYS, isOverlayLocation, parsePreferences, resolveAttributes, type MediaState } from "../../src/state/preferenceSchema.ts";

/** Runs the inline script against a fake window and returns the attributes it set. */
function runPrepaint(stored: Record<string, string>, media: MediaState, location = { search: "", hash: "" }): Record<string, string> {
  const attrs: Record<string, string> = {};
  const fakeWindow = {
    location,
    matchMedia: (query: string) => ({
      matches: query.includes("prefers-color-scheme: dark") ? media.prefersDark : media.prefersMoreContrast,
    }),
  };
  const fakeDocument = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
  const fakeStorage = { getItem: (k: string) => stored[k] ?? null };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- evaluating our own generated script is the point
  const run = new Function("window", "document", "localStorage", prepaintScript()) as (
    w: typeof fakeWindow,
    d: typeof fakeDocument,
    s: typeof fakeStorage,
  ) => void;
  run(fakeWindow, fakeDocument, fakeStorage);
  return attrs;
}

const MEDIA: MediaState[] = [
  { prefersDark: true, prefersMoreContrast: false },
  { prefersDark: false, prefersMoreContrast: true },
];

const STORED: Array<Record<string, string>> = [
  {},
  { [PREFERENCE_KEYS.theme]: "light", [PREFERENCE_KEYS.density]: "compact" },
  { [PREFERENCE_KEYS.theme]: "dark", [PREFERENCE_KEYS.contrast]: "high", [PREFERENCE_KEYS.cvd]: "true" },
  { [PREFERENCE_KEYS.theme]: "bogus", [PREFERENCE_KEYS.density]: "huge", [PREFERENCE_KEYS.contrast]: "x" },
  { [PREFERENCE_KEYS.accent]: "teal" },
  { [PREFERENCE_KEYS.theme]: "light", [PREFERENCE_KEYS.accent]: "neon" },
];

describe("pre-paint script", () => {
  for (const stored of STORED) {
    for (const media of MEDIA) {
      it(`matches resolveAttributes for ${JSON.stringify(stored)} / ${JSON.stringify(media)}`, () => {
        const expected = resolveAttributes(
          parsePreferences((k) => stored[k] ?? null),
          media,
        );
        expect(runPrepaint(stored, media)).toEqual(expected);
      });
    }
  }

  const LOCATIONS = [
    { search: "?overlay", hash: "" },
    { search: "", hash: "#rivenoverlay" },
    { search: "", hash: "#modular" },
  ];
  for (const location of LOCATIONS) {
    for (const overlayTheme of ["app", "dark", "light", "bogus"]) {
      it(`matches resolveAttributes in ${location.search || location.hash} with overlay theme ${overlayTheme}`, () => {
        const stored: Record<string, string> = { [PREFERENCE_KEYS.theme]: "light", [PREFERENCE_KEYS.overlayTheme]: overlayTheme };
        const media = MEDIA[0] as MediaState;
        const expected = resolveAttributes(
          parsePreferences((k) => stored[k] ?? null),
          media,
          isOverlayLocation(location),
        );
        expect(runPrepaint(stored, media, location)).toEqual(expected);
      });
    }
  }

  it("keeps overlays dark by default while the app is light", () => {
    const stored = { [PREFERENCE_KEYS.theme]: "light" };
    expect(runPrepaint(stored, MEDIA[0] as MediaState, { search: "", hash: "#relicpickoverlay" })["data-resolved-theme"]).toBe("dark");
    expect(runPrepaint(stored, MEDIA[0] as MediaState)["data-resolved-theme"]).toBe("light");
  });

  it("restores the chosen accent and falls back to amber", () => {
    expect(runPrepaint({ [PREFERENCE_KEYS.accent]: "rose" }, MEDIA[0] as MediaState)["data-accent"]).toBe("rose");
    expect(runPrepaint({ [PREFERENCE_KEYS.accent]: "neon" }, MEDIA[0] as MediaState)["data-accent"]).toBe("amber");
    expect(runPrepaint({}, MEDIA[0] as MediaState)["data-accent"]).toBe("amber");
  });

  it("renders light when chosen", () => {
    const attrs = runPrepaint({ [PREFERENCE_KEYS.theme]: "light" }, MEDIA[0] as MediaState);
    expect(attrs["data-theme"]).toBe("light");
    expect(attrs["data-resolved-theme"]).toBe("light");
  });
});

describe("text scale preference", () => {
  it.each([
    ["1.25", 1.3],
    ["0.5", 0.8],
    ["3", 2],
    ["abc", 1],
    ["1.2", 1.2],
  ])("parses %s as %f", (stored, expected) => {
    expect(parsePreferences((k) => (k === PREFERENCE_KEYS.textScale ? stored : null)).textScale).toBe(expected);
  });
});
