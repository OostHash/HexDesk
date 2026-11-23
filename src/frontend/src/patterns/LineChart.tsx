import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "../primitives/cn";

export type LinePoint = { x: string; y: number };

type Props = {
  points: readonly LinePoint[];
  /** Accessible name, e.g. "Ferrite quantity, last 30 days". */
  label: string;
  /** Formats a point for the tooltip and screen readers, e.g. "12 Nov · 12,450". */
  describe: (p: LinePoint) => { title: string; value: string };
  /** Shown instead of a chart when there are no points. */
  empty: string;
  className?: string;
};

const W = 300;
const H = 64;
const PAD = 6;

/**
 * Single-series line (dataviz: 2px line, ~10% area wash, end dot, recessive
 * hairline crosshair that snaps to the nearest point). It is a slider over
 * the points: arrow keys, Home and End move the crosshair and the value text
 * is announced; hover shows the same tooltip. Every value is also in the
 * figures next to the chart.
 */
export function LineChart({ points, label, describe, empty, className }: Props) {
  const [active, setActive] = useState<number | null>(null);
  if (points.length === 0) {
    return <p className={cn("flex h-16 items-center justify-center rounded-md bg-surface-sunken text-xs text-muted italic", className)}>{empty}</p>;
  }
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys);
  const range = Math.max(...ys) - min || 1;
  const x = (i: number) => (points.length === 1 ? W / 2 : PAD + (i / (points.length - 1)) * (W - 2 * PAD));
  const y = (v: number) => (points.length === 1 ? H / 2 : PAD + (1 - (v - min) / range) * (H - 2 * PAD));
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const area = `${x(0).toFixed(1)},${String(H)} ${line} ${x(points.length - 1).toFixed(1)},${String(H)}`;
  const last = points.length - 1;
  const shown = active === null ? null : points[active];
  const info = shown ? describe(shown) : null;

  const nearest = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setActive(best);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const from = active ?? last;
    setActive(Math.max(0, Math.min(last, step === -Infinity ? 0 : step === Infinity ? last : from + step)));
  };

  return (
    <div className={cn("relative", className)}>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={active ?? last}
        aria-valuetext={(() => {
          const p = points[active ?? last];
          if (!p) return "";
          const d = describe(p);
          return `${d.title}: ${d.value}`;
        })()}
        onPointerMove={nearest}
        onPointerLeave={() => {
          setActive(null);
        }}
        onKeyDown={onKey}
        onBlur={() => {
          setActive(null);
        }}
        className="rounded-md bg-surface-sunken outline-none focus-visible:outline-2 focus-visible:outline-focus"
      >
        <svg viewBox={`0 0 ${String(W)} ${String(H)}`} preserveAspectRatio="none" aria-hidden="true" className="block h-16 w-full">
          {points.length > 1 && <polygon points={area} fill="var(--hex-accent)" fillOpacity={0.1} />}
          {points.length > 1 ? (
            <polyline
              points={line}
              fill="none"
              stroke="var(--hex-accent)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} stroke="var(--hex-border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )}
          {active !== null && (
            <line x1={x(active)} x2={x(active)} y1={0} y2={H} stroke="var(--hex-border-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {/* Dots as HTML so they stay round with preserveAspectRatio="none". */}
        {[active ?? last].map((i) => {
          const p = points[i];
          return p ? (
            <span
              key={i}
              aria-hidden="true"
              className="pointer-events-none absolute size-2 -translate-1/2 rounded-full bg-accent ring-2 ring-surface-sunken"
              style={{ left: `${String((x(i) / W) * 100)}%`, top: `${String((y(p.y) / H) * 100)}%` }}
            />
          ) : null;
        })}
      </div>
      {info && active !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-md border border-border bg-surface-raised px-2 py-1 text-xs whitespace-nowrap shadow-2"
          style={{ left: `${String(Math.min(85, Math.max(15, (x(active) / W) * 100)))}%` }}
        >
          <strong className="font-semibold tabular-nums">{info.value}</strong> <span className="text-muted">{info.title}</span>
        </div>
      )}
    </div>
  );
}
