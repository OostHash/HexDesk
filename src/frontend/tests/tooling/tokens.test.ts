import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generatedFiles } from "../../src/theme/build.ts";
import {
  contrastPairs,
  cvdHighContrastThemes,
  cvdThemes,
  highContrastThemes,
  semanticTokens,
  themes,
  type ThemeName,
  type ThemeTokens,
} from "../../src/theme/tokens.ts";

/** Resolves a token to a hex colour, following var(--hex-x) references within the theme. */
function resolveHex(theme: ThemeTokens, token: string, seen = new Set<string>()): string {
  if (seen.has(token)) throw new Error(`token cycle at ${token}`);
  seen.add(token);
  const value = (theme as Record<string, string | undefined>)[token];
  if (value === undefined) throw new Error(`unknown token ${token}`);
  const ref = /^var\(--hex-([a-z0-9-]+)\)$/.exec(value);
  if (ref?.[1] !== undefined) return resolveHex(theme, ref[1], seen);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${token} is not a plain hex colour: ${value}`);
  return value;
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2.x contrast ratio. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrast", () => {
  it("computes known ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  // Every theme in normal and high contrast, each with and without the colour-blind palette.
  const sets = (Object.keys(themes) as ThemeName[]).flatMap((name) => [
    { name, high: false, theme: themes[name] },
    { name: `${name} + colour-blind palette`, high: false, theme: { ...themes[name], ...cvdThemes[name] } },
    { name: `${name} high contrast`, high: true, theme: highContrastThemes[name] },
    { name: `${name} high contrast + colour-blind palette`, high: true, theme: { ...highContrastThemes[name], ...cvdHighContrastThemes[name] } },
  ]);
  // High contrast: 7:1 for text, and borders that read as edges (WCAG 1.4.11).
  const pairsFor = (high: boolean) =>
    high
      ? [
          ...contrastPairs.map((p) => ({ ...p, min: p.min >= 4.5 ? 7 : p.min })),
          { fg: "border" as const, bg: "surface" as const, min: 3, why: "control edges" },
          { fg: "border" as const, bg: "bg" as const, min: 3, why: "control edges on the page" },
        ]
      : contrastPairs;
  for (const { name, high, theme } of sets) {
    describe(name, () => {
      for (const { fg, bg, min, why } of pairsFor(high)) {
        it(`${fg} on ${bg} ≥ ${String(min)}:1 (${why})`, () => {
          const ratio = contrast(resolveHex(theme, fg), resolveHex(theme, bg));
          expect(ratio, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }
});

describe("themes", () => {
  it("define every semantic token", () => {
    for (const theme of [...Object.values(themes), ...Object.values(highContrastThemes)]) {
      expect(Object.keys(theme).sort()).toEqual([...semanticTokens].sort());
    }
  });
});

describe("generated CSS", () => {
  const dir = new URL("../../src/theme/generated/", import.meta.url);
  for (const [file, render] of Object.entries(generatedFiles)) {
    it(`${file} is up to date (run pnpm tokens)`, async () => {
      const onDisk = await readFile(fileURLToPath(new URL(file, dir)), "utf8");
      expect(onDisk).toBe(render());
    });
  }
});
