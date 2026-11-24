import { Check, Lock, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../../api/env";
import { onEvent } from "../../api/events";
import { invoke } from "../../api/invoke";
import { fitPickWindow, useOverlayPrefs } from "../../api/overlays";
import {
  eraLabel,
  pickSummary,
  PREVIEW_PICK,
  dropChance,
  rarityLabel,
  refinementLabel,
  scoreHeadline,
  shownRewards,
  topRelics,
  type PickPriority,
  type PickReward,
  type RelicPick,
} from "../../domain/relicPick";
import { IconButton } from "../../primitives/actions";
import { cn } from "../../primitives/cn";
import { Badge, domainTone, Icon } from "../../primitives/display";
import { usePreferences } from "../../state/preferences";
import { OVERLAY_DIVIDER, OVERLAY_HEADING, OVERLAY_INSET, OVERLAY_PANEL } from "./overlayStyles";

type Source = "idle" | "preview" | "live";

const RARITY_TONE: Readonly<Record<string, "rarity-bronze" | "rarity-silver" | "rarity-gold">> = {
  Bronze: "rarity-bronze",
  Silver: "rarity-silver",
  Gold: "rarity-gold",
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Name, chance, plat, ducats, new: shared by the rows and the column legend. */
const REWARD_GRID = "grid grid-cols-[1fr_3.25rem_2.75rem_3rem_3rem] items-center gap-2 px-2";

/** The column names above the rewards, so the numbers need no unit letters. */
function RewardLegend() {
  return (
    <div aria-hidden="true" className={cn(REWARD_GRID, "text-xs text-muted")}>
      <span className="inline-flex items-center gap-1">
        <Icon icon={Lock} size="xs" /> vaulted
      </span>
      <span className="text-center">Chance</span>
      <span className="text-end">Plat</span>
      <span className="text-end">Ducats</span>
      <span />
    </div>
  );
}

/**
 * One reward: name, drop chance (tinted by rarity, which the chance already
 * tells in numbers), platinum, ducats and whether it is new. The value the
 * ranking is about is bold.
 */
function RewardRow({ reward, priority }: { reward: PickReward; priority: PickPriority }) {
  const tone = RARITY_TONE[reward.rarity];
  return (
    <li className={cn(REWARD_GRID, "border-b border-border py-1.5 text-sm last:border-b-0")}>
      <span className="flex min-w-0 items-center gap-1">
        <span className={cn("truncate", reward.owned ? "text-muted" : "font-medium")}>{reward.name}</span>
        {reward.vaulted && <Icon icon={Lock} size="xs" label="vaulted" className="text-muted" />}
      </span>
      <Badge
        tone="domain"
        style={tone ? domainTone(tone) : undefined}
        title={`${rarityLabel(reward.rarity)} drop`}
        className={cn("justify-center tabular-nums", priority === "unowned" && "font-semibold")}
      >
        {dropChance(reward.drop_rate)}
        <span className="sr-only"> drop chance, {rarityLabel(reward.rarity)}</span>
      </Badge>
      <span className={cn("text-end tabular-nums", priority === "platinum" && "font-semibold")}>
        {reward.plat > 0 ? `${fmt(reward.plat)}p` : "—"}
      </span>
      <span className={cn("text-end tabular-nums", priority === "ducat" && "font-semibold")}>
        {reward.ducats > 0 ? fmt(reward.ducats) : "—"}
        {reward.ducats > 0 && <span className="sr-only"> ducats</span>}
      </span>
      {reward.owned ? (
        <Icon icon={Check} size="xs" label="owned" className="justify-self-center text-muted" />
      ) : (
        <Badge tone="accent" className="justify-center">
          New
        </Badge>
      )}
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
    <main ref={measure} aria-label="Relic pick" className={cn("flex flex-col gap-1 px-2 py-1.5", OVERLAY_PANEL)}>
      <header className="flex items-center gap-1.5">
        <h1 className={cn("flex-1", OVERLAY_HEADING)}>{era} Fissure</h1>
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
        <>
          {pickLines !== "estimated" && <RewardLegend />}
          <ol aria-label="Recommended relics" className="flex flex-col gap-1">
            {relics.map((relic, i) => {
              const rewards = shownRewards(relic, pickLines, pickPriority);
              const headline = scoreHeadline(relic, pickPriority);
              return (
                <li key={relic.name} className={cn("overflow-hidden", OVERLAY_INSET, i === 0 && "border-accent")}>
                  <header className={cn("flex flex-col gap-0.5 border-b px-2 py-1.5", OVERLAY_DIVIDER)}>
                    <div className="flex items-center gap-1.5">
                      <h2 className="flex-1 truncate font-semibold">
                        {relic.count}× {relic.base_name} <span className="text-xs font-normal text-muted">{refinementLabel(relic.refinement)}</span>
                      </h2>
                      {i === 0 && (
                        <Badge tone="accent" variant="solid">
                          Best
                        </Badge>
                      )}
                      {relic.on_screen === false && (
                        <Badge tone="warning" variant="outline" title="Not found on the relic list on screen">
                          not on screen
                        </Badge>
                      )}
                    </div>
                    <p className="flex items-baseline gap-1.5">
                      <span className="text-lg leading-tight font-semibold tabular-nums">{headline.value}</span>
                      <span className="text-xs text-muted">{headline.caption}</span>
                    </p>
                  </header>
                  {pickLines === "estimated" ? (
                    <p className="px-2 py-1 text-muted">
                      {relic.plat_score.toFixed(0)}p · {relic.ducat_score.toFixed(0)} ducats · {relic.rewards.filter((r) => !r.owned).length}/
                      {relic.rewards.length} new
                    </p>
                  ) : (
                    <ul aria-label={`${relic.base_name} rewards`}>
                      {rewards.map((r) => (
                        <RewardRow key={r.name} reward={r} priority={pickPriority} />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </main>
  );
}
