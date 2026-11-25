import type { CSSProperties } from "react";
import { domainTone, type Tone } from "../../primitives/display";

/** Badge tone and optional domain colour for a timer state word. */
export type StateTone = { tone: Tone; style?: CSSProperties };

const DOMAIN: Record<string, Parameters<typeof domainTone>[0]> = {
  Day: "state-day",
  Night: "state-cool",
  Warm: "state-warm",
  Cold: "state-cool",
  Joy: "state-joy",
  Anger: "state-anger",
  Envy: "state-envy",
  Sorrow: "state-sorrow",
  Fear: "state-void",
};

export function stateTone(state: string, kind?: "cambion" | "duviri" | "circuit"): StateTone {
  if (kind === "cambion") return { tone: "domain", style: domainTone("state-fass") };
  if (kind === "circuit") return { tone: "domain", style: domainTone("state-void") };
  const domain = DOMAIN[state];
  if (domain) return { tone: "domain", style: domainTone(domain) };
  if (state === "Active" || state === "Here" || state === "Event") return { tone: "success" };
  return { tone: "neutral" };
}
