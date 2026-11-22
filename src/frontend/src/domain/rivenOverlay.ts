import type { RivenAnalysis, RollStat } from "./rivens";

/** Riven overlay rules. Pure functions. */

/** analyze_riven also reports these (the screens did not need them so far). */
export type OverlayAnalysis = RivenAnalysis & { matched_positives?: string[]; missing_positives?: string[] };

/** The overlay's state, as the backend sends it (riven-view); `view` numbers a live view. */
export type RivenView = (
  | { kind: "scanning"; rollCount: number }
  | {
      kind: "result";
      /** A Settings preview, which live data replaces. */
      preview: boolean;
      rollCount: number;
      analysis: OverlayAnalysis | null;
      weapon: string;
      rolledStats: RollStat[];
      originalStats: RollStat[];
      isComparison: boolean;
      ocrRaw: string;
    }
) & { view?: number };

/** One line for the log: what the overlay shows. */
export function rivenSummary(view: RivenView): string {
  if (view.kind === "scanning") return `scanning, roll ${String(view.rollCount)}`;
  const verdict = view.analysis?.verdict ?? "no analysis";
  return `${view.weapon || "no weapon"}: ${String(view.rolledStats.length)} stats, ${verdict}`;
}

export type StatClass = "wanted" | "neutral" | "safe" | "harmful";
export const STAT_LABEL: Readonly<Record<StatClass, string>> = { wanted: "Wanted", neutral: "Neutral", safe: "Safe", harmful: "Harmful" };

/** A stat on the new roll: wanted when matched, safe or harmful when negative. */
export function classifyStat(stat: RollStat, analysis: OverlayAnalysis | null): StatClass {
  if (!analysis) return "neutral";
  if (!stat.positive) return analysis.safe_negatives_present.includes(stat.name) ? "safe" : "harmful";
  return (analysis.matched_positives ?? []).includes(stat.name) ? "wanted" : "neutral";
}

/** Every wanted stat: matched ones and each name in a missing group ("MS / TOX"). */
export function wantedNames(analysis: OverlayAnalysis | null): Set<string> {
  const names = new Set<string>();
  if (!analysis) return names;
  for (const s of analysis.matched_positives ?? []) names.add(s);
  for (const group of analysis.missing_positives ?? []) for (const s of group.split(" / ")) names.add(s.trim());
  return names;
}

/** A stat on the original roll (comparison): wanted by the full list; a negative is safe or neutral. */
export function classifyOriginal(stat: RollStat, analysis: OverlayAnalysis | null, wanted: ReadonlySet<string>): StatClass {
  if (!analysis) return "neutral";
  if (!stat.positive) return analysis.safe_negatives_present.includes(stat.name) ? "safe" : "neutral";
  return wanted.has(stat.name) ? "wanted" : "neutral";
}

/** "tenora prime" → "Tenora Prime"; "Riven Analyzer" without a weapon. */
export function weaponTitle(weapon: string): string {
  if (!weapon) return "Riven Analyzer";
  return weapon
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** "Tenora prime · Roll #4 · 12 Nov". */
export function savedRollLabel(weapon: string, rollCount: number, date: Date): string {
  const month = date.toLocaleString("en", { month: "short" });
  return `${weapon.charAt(0).toUpperCase()}${weapon.slice(1)} · Roll #${String(rollCount)} · ${String(date.getDate())} ${month}`;
}

// ── Window ──────────────────────────────────────────────────────────────────

/** The window's width at text size 100 %; matches the backend's placement. */
export const RIVEN_WIDTH = 300;

// ── Preview ─────────────────────────────────────────────────────────────────

export const PREVIEW_VIEW: RivenView = {
  kind: "result",
  preview: true,
  rollCount: 4,
  weapon: "Tenora Prime",
  isComparison: false,
  ocrRaw: "TENORA PRIME\n+180% Critical Chance",
  analysis: {
    weapon: "Tenora Prime",
    matched_positives: ["Critical Chance", "Damage to Grineer"],
    missing_positives: ["Multi-shot"],
    safe_negatives_present: ["Zoom"],
    harmful_negatives: ["Damage to Corpus"],
    score: 0.78,
    verdict: "GOOD — usable",
    notes: "Preview",
    alternatives: [
      { label: "Crit build", matched: ["Critical Chance", "Damage to Grineer"], missing: ["Multi-shot"], score: 0.78, verdict: "GOOD — usable" },
    ],
  },
  rolledStats: [
    { name: "Critical Chance", value: "+180%", positive: true },
    { name: "Damage to Grineer", value: "+145%", positive: true },
    { name: "Multi-shot", value: "+85%", positive: true },
    { name: "Damage to Corpus", value: "-20%", positive: false },
  ],
  originalStats: [],
};
