import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../../api/env";
import { onEvent } from "../../api/events";
import { invoke } from "../../api/invoke";
import { fitPickWindow, useOverlayPrefs } from "../../api/overlays";
import {
  eraLabel,
  pickSummary,
  PREVIEW_PICK,
  recommendedRefinement,
  refinementLabel,
  scoreLabel,
  shownRewards,
  topRelics,
  type PickReward,
  type RelicPick,
} from "../../domain/relicPick";
import { IconButton } from "../../primitives/actions";
import { cn } from "../../primitives/cn";
import { Badge, domainTone } from "../../primitives/display";
import { usePreferences } from "../../state/preferences";

type Source = "idle" | "preview" | "live";

const RARITY_TONE: Readonly<Record<string, "rarity-bronze" | "rarity-silver" | "rarity-gold">> = {
  Bronze: "rarity-bronze",
  Silver: "rarity-silver",
  Gold: "rarity-gold",
};

function RewardRow({ reward }: { reward: PickReward }) {
  const tone = RARITY_TONE[reward.rarity];
  return (
    <li className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-1.5 border-b border-border/25 px-2 py-0.5 text-xs last:border-b-0">
      <span className={cn("w-12 text-center", reward.owned ? "text-success" : "text-muted")}>{reward.owned ? "Owned" : "New"}</span>
      <span className="truncate">
        <span className={cn("font-medium", tone && "text-(--ff-tone)")} style={tone ? domainTone(tone) : undefined}>
          {reward.name}
        </span>
        <span className="sr-only">
          , {reward.rarity}
          {reward.vaulted ? ", vaulted" : ""}
        </span>
        {reward.vaulted && (
          <span aria-hidden="true" title="Vaulted" className="ms-1 text-muted">
            V
          </span>
        )}
      </span>
      <span className="tabular-nums">{reward.plat > 0 ? `${String(reward.plat)}p` : ""}</span>
      <span className="tabular-nums">{reward.ducats > 0 ? `${String(reward.ducats)}d` : ""}</span>
      <Badge variant="outline" title="Refinement worth running for this reward">
        {recommendedRefinement(reward.rarity)}
      </Badge>
    </li>
  );
}

/**
 * The relic pick window (relic-pick-overlay): when the relic selection
 * screen opens, the three relics most worth running for the chosen priority.
 * The backend places and shows the window. The window takes the mouse, so
 * the cursor shows over it and the close button can be clicked.
 */
export function RelicPickOverlay() {
  const [source, setSource] = useState<Source>("idle");
  const [pick, setPick] = useState<RelicPick | null>(null);
  const { pickPriority, pickLines } = useOverlayPrefs();
  const { textScale } = usePreferences();

  const hide = useCallback(() => {
    setSource("idle");
    setPick(null);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const keep = (p: Promise<() => void>) => {
      void p.then((fn) => {
        if (disposed) fn();
        else unlisteners.push(fn);
      });
    };
    keep(
      onEvent("relic-pick-open", (payload) => {
        setPick(payload);
        setSource("live");
      }),
    );
    keep(onEvent("relic-pick-close", hide));
    keep(
      onEvent("relic-pick-preview", () => {
        setSource((prev) => (prev === "live" ? prev : "preview"));
      }),
    );
    keep(
      onEvent("relic-pick-preview-close", () => {
        setSource((prev) => {
          if (prev !== "live") void invoke("park_relic_pick_window").catch(() => undefined);
          return prev === "live" ? prev : "idle";
        });
      }),
    );
    keep(onEvent("overlays-disabled", hide));
    return () => {
      disposed = true;
      for (const fn of unlisteners) fn();
    };
  }, [hide]);

  // Tell the backend the view is on screen, after the browser painted it.
  useEffect(() => {
    if (source !== "live" || !pick || pick.view === undefined || !isTauri()) return;
    const view = pick.view;
    const frame = requestAnimationFrame(() => {
      void invoke("overlay_rendered", { overlay: "relic_pick", view, summary: pickSummary(pick, pickPriority) }).catch(() => undefined);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [source, pick, pickPriority]);

  // The window follows the content height (and the text size).
  const root = useRef<HTMLElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const scale = useRef(textScale);
  useEffect(() => {
    scale.current = textScale;
    if (root.current && isTauri()) void fitPickWindow(Math.ceil(root.current.offsetHeight), textScale).catch(() => undefined);
  }, [textScale]);
  const measure = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    root.current = el;
    if (!el || !isTauri()) return;
    observer.current = new ResizeObserver(() => {
      void fitPickWindow(Math.ceil(el.offsetHeight), scale.current).catch(() => undefined);
    });
    observer.current.observe(el);
  }, []);

  if (source === "idle") return null;
  const data = source === "preview" ? PREVIEW_PICK : pick;
  if (!data) return null;
  const relics = topRelics(data, pickPriority);
  const era = eraLabel(data.era);

  return (
    <main
      ref={measure}
      aria-label="Relic pick"
      className="flex flex-col gap-1 rounded-lg border border-accent/40 bg-bg/95 px-2 py-1.5 text-xs text-text"
    >
      <header className="flex items-center gap-1.5">
        <h1 className="flex-1 text-xs font-semibold tracking-wide text-info uppercase">{era} Fissure</h1>
        <IconButton
          size="sm"
          icon={X}
          label="Close relic pick"
          onClick={() => {
            // The backend tracks what is on screen, so it hears about the close.
            if (source === "live" && isTauri()) void invoke("overlay_closed").catch(() => undefined);
            if (source === "preview" && isTauri()) void invoke("park_relic_pick_window").catch(() => undefined);
            hide();
          }}
        />
      </header>
      {relics.length === 0 ? (
        <p className="px-2 py-3 text-center text-muted">
          {data.relics.length === 0 ? `No ${era} relics in inventory` : `No ${era} relics confirmed on screen`}
        </p>
      ) : (
        <ol aria-label="Recommended relics" className="flex flex-col gap-1">
          {relics.map((relic, i) => {
            const rewards = shownRewards(relic, pickLines, pickPriority);
            return (
              <li
                key={relic.name}
                className={cn("overflow-hidden rounded-md border", i === 0 ? "border-accent/50 bg-accent/5" : "border-border/60 bg-surface/60")}
              >
                <h2 className="flex items-center gap-1.5 border-b border-border/50 px-2 py-1 text-xs">
                  <span className={cn("min-w-5 font-semibold", i === 0 ? "text-info" : "text-muted")}>#{i + 1}</span>
                  <span className="flex-1 truncate text-sm font-semibold">{relic.base_name}</span>
                  <Badge variant="outline">{refinementLabel(relic.refinement)}</Badge>
                  {relic.on_screen === false && (
                    <Badge tone="warning" variant="outline" title="Not found on the relic list on screen">
                      not on screen
                    </Badge>
                  )}
                  <span className="text-muted">×{relic.count}</span>
                  <span className="font-semibold whitespace-nowrap text-info">{scoreLabel(relic, pickPriority)}</span>
                </h2>
                {pickLines === "estimated" ? (
                  <p className="px-2 py-1 text-muted">
                    {relic.plat_score.toFixed(0)}p · {relic.ducat_score.toFixed(0)} ducats · {relic.rewards.filter((r) => !r.owned).length}/
                    {relic.rewards.length} new
                  </p>
                ) : (
                  <ul aria-label={`${relic.base_name} rewards`}>
                    {rewards.map((r) => (
                      <RewardRow key={r.name} reward={r} />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
