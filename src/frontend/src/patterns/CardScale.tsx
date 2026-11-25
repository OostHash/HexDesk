import { Minus, Plus } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { PageSizeScreen } from "./PageSize";

/**
 * Card size per screen, chosen in its toolbar with − / + and remembered in
 * localStorage (like the page size). It scales the minimum card width of the
 * grid, so it sets how many cards fit side by side.
 */
const MIN = 60;
const MAX = 160;
const STEP = 10;
const DEFAULT = 100;

const storageKey = (screen: PageSizeScreen) => `ff-card-scale-${screen}`;

const readStored = (screen: PageSizeScreen): number => {
  try {
    const v = Number(localStorage.getItem(storageKey(screen)));
    return Number.isInteger(v) && v >= MIN && v <= MAX && v % STEP === 0 ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
};

/** The remembered card scale of a screen, in percent. */
export function useCardScale(screen: PageSizeScreen) {
  const [scale, setScale] = useState(() => readStored(screen));
  const set = (next: number) => {
    const clamped = Math.min(MAX, Math.max(MIN, next));
    setScale(clamped);
    try {
      localStorage.setItem(storageKey(screen), String(clamped));
    } catch {
      // Storage full or blocked: the choice still holds for this session.
    }
  };
  return [scale, set] as const;
}

/** Grid of cards whose minimum width is `baseRem` at 100%; use with `cardGridStyle`. */
export const CARD_GRID = "grid grid-cols-[repeat(auto-fill,minmax(var(--hex-card-min),1fr))] gap-3";

export const cardGridStyle = (baseRem: number, scale: number): CSSProperties =>
  ({ "--hex-card-min": `min(${String((baseRem * scale) / 100)}rem,100%)` }) as CSSProperties;

const stepButton =
  "inline-flex h-full w-7 items-center justify-center text-muted transition-colors motion-reduce:transition-none hover:bg-hover hover:text-text " +
  "disabled:opacity-50 disabled:hover:bg-transparent";

/** "− 100% +" stepper for a screen's toolbar, next to Per page. */
export function CardScaleStepper({ value, onChange }: { value: number; onChange: (scale: number) => void }) {
  return (
    <div
      role="group"
      aria-label="Card size"
      title="Card size"
      className="inline-flex h-control-sm items-center overflow-hidden rounded-md border border-border bg-surface text-xs"
    >
      <button
        type="button"
        aria-label="Smaller cards"
        className={stepButton}
        disabled={value <= MIN}
        onClick={() => {
          onChange(value - STEP);
        }}
      >
        <Minus aria-hidden="true" className="size-3.5" />
      </button>
      <output aria-live="polite" className="w-11 text-center text-text tabular-nums">
        {value}%
      </output>
      <button
        type="button"
        aria-label="Larger cards"
        className={stepButton}
        disabled={value >= MAX}
        onClick={() => {
          onChange(value + STEP);
        }}
      >
        <Plus aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
