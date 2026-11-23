import { useId, type CSSProperties } from "react";
import { cn } from "../cn";
import type { Tone } from "./tone";

const FILL: Record<Exclude<Tone, "domain">, string> = {
  neutral: "[--progress:var(--hex-text-muted)]",
  accent: "[--progress:var(--hex-accent)]",
  info: "[--progress:var(--hex-info)]",
  success: "[--progress:var(--hex-success)]",
  warning: "[--progress:var(--hex-warning)]",
  danger: "[--progress:var(--hex-danger)]",
};

type Props = {
  value: number;
  max: number;
  /** Visible text next to the bar, e.g. "12 / 40 complete"; also the accessible value text. */
  label: string;
  /** Accessible name of the bar, e.g. "Steel Meridian progress". */
  name: string;
  tone?: Tone;
  /** For tone="domain": domainTone(...). */
  style?: CSSProperties;
  className?: string;
};

/** Native <progress> with a visible label; colour from a tone or a domain colour. */
export function ProgressBar({ value, max, label, name, tone = "accent", style, className }: Props) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)} style={style}>
      <progress
        aria-label={name}
        aria-describedby={id}
        value={max > 0 ? value : 0}
        max={max > 0 ? max : 1}
        className={cn(
          "h-1.5 w-full max-w-48 min-w-16 overflow-hidden rounded-full appearance-none",
          "[&::-webkit-progress-bar]:bg-hover [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-(--progress)",
          "[&::-webkit-progress-value]:transition-[width] motion-reduce:[&::-webkit-progress-value]:transition-none",
          tone === "domain" ? "[--progress:var(--hex-tone,var(--hex-accent))]" : FILL[tone],
        )}
      />
      <span id={id} className="shrink-0 text-xs whitespace-nowrap text-muted tabular-nums">
        {label}
      </span>
    </div>
  );
}
