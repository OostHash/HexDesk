/** Rules for the item icon check (Settings → Debugging, development builds). */

/** What is wrong with an item's icon. */
export type IconProblem = "not-in-catalogue" | "no-image-name" | "not-found" | "empty" | "mostly-white" | "mostly-black" | "unreadable";

/** In report order: the gaps first, then icons that load but are hard to see. */
export const ICON_PROBLEMS: readonly IconProblem[] = [
  "not-in-catalogue",
  "no-image-name",
  "not-found",
  "empty",
  "mostly-white",
  "mostly-black",
  "unreadable",
];

export const ICON_PROBLEM_LABEL: Readonly<Record<IconProblem, string>> = {
  "not-in-catalogue": "Owned but not in the catalogue",
  "no-image-name": "No image name in the catalogue",
  "not-found": "Image not found (cache and CDN)",
  empty: "Image is empty or almost transparent",
  "mostly-white": "Image is mostly white",
  "mostly-black": "Image is mostly black",
  unreadable: "Image loaded but its pixels could not be read",
};

/** Alpha (0–255) from which a pixel counts as visible. */
const VISIBLE_ALPHA = 32;
/** Relative luminance above which a pixel is near white, and below which near black. */
const NEAR_WHITE = 0.9;
const NEAR_BLACK = 0.1;
/** Share of visible pixels that must be near white (or near black) to flag the icon. */
export const TONE_SHARE = 0.9;
/** An icon with fewer visible pixels than this share shows as (nearly) nothing. */
const MIN_VISIBLE_SHARE = 0.02;

/**
 * Judges an icon from its RGBA pixels (canvas ImageData order). Null means it
 * looks fine: enough visible pixels, not nearly all white or all black.
 */
export function classifyPixels(rgba: ArrayLike<number>): "empty" | "mostly-white" | "mostly-black" | null {
  const pixels = Math.floor(rgba.length / 4);
  let visible = 0;
  let white = 0;
  let black = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    if ((rgba[o + 3] ?? 0) < VISIBLE_ALPHA) continue;
    visible++;
    const luminance = (0.2126 * (rgba[o] ?? 0) + 0.7152 * (rgba[o + 1] ?? 0) + 0.0722 * (rgba[o + 2] ?? 0)) / 255;
    if (luminance >= NEAR_WHITE) white++;
    else if (luminance <= NEAR_BLACK) black++;
  }
  if (pixels === 0 || visible / pixels < MIN_VISIBLE_SHARE) return "empty";
  if (white / visible >= TONE_SHARE) return "mostly-white";
  if (black / visible >= TONE_SHARE) return "mostly-black";
  return null;
}

export type IconFinding = { name: string; category: string; uniqueName: string; imageName: string | null; problem: IconProblem };

/** Plain-text report, grouped by problem, to paste into an issue. */
export function formatIconReport(findings: readonly IconFinding[], checked: number): string {
  const lines = [`Item icon check: ${String(checked)} items checked, ${String(findings.length)} with a problem.`];
  for (const problem of ICON_PROBLEMS) {
    const group = findings.filter((f) => f.problem === problem);
    if (group.length === 0) continue;
    lines.push("", `${ICON_PROBLEM_LABEL[problem]} (${String(group.length)})`);
    for (const f of [...group].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- ${f.name} [${f.category}] ${f.imageName ?? f.uniqueName}`);
    }
  }
  return lines.join("\n");
}
