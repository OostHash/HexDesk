import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { isTauri } from "../../api/env";
import { onEvent, type RelicRewards } from "../../api/events";
import { invoke } from "../../api/invoke";
import { hideRewardStrip, logRelic, takePendingRewards, useItemPrices, useOverlayPrefs, useRewardCards } from "../../api/overlays";
import { Circle, CircleCheck, CircleDashed } from "lucide-react";
import {
  cardsFrom,
  bestPick,
  cardWidth,
  cellLabel,
  columnCenters,
  PREVIEW_CARDS,
  priceNames,
  rewardSummary,
  shortName,
  type RewardCard,
  type RewardComponent,
} from "../../domain/relicReward";
import { cn } from "../../primitives/cn";
import { Badge, domainTone, Icon } from "../../primitives/display";
import { OVERLAY_DIVIDER, OVERLAY_HEADING, OVERLAY_PANEL, OVERLAY_PANEL_HIGHLIGHT } from "./overlayStyles";

type Source = "idle" | "preview" | "live";
type Session = { source: Source; paths: string[]; uncertain: boolean[] };
const IDLE: Session = { source: "idle", paths: [], uncertain: [] };
const NO_PRICES: ReadonlyMap<string, number> = new Map();

function subscribeResize(listener: () => void) {
  window.addEventListener("resize", listener);
  return () => {
    window.removeEventListener("resize", listener);
  };
}
const useWindowWidth = () => useSyncExternalStore(subscribeResize, () => window.innerWidth);

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function Plat({ value }: { value: number | undefined }) {
  if (value === undefined) return <span className="text-muted">—</span>;
  return (
    <Badge tone="domain" style={domainTone("price-platinum")} title={`${fmt(value)} platinum`}>
      {fmt(value)}p
    </Badge>
  );
}

/** One set part: owned of needed, with an icon so complete does not rest on colour. */
function PartRow({ part, setName, isReward }: { part: RewardComponent; setName: string; isReward: boolean }) {
  const have = part.owned >= part.needed;
  const label = cellLabel(part.name, setName);
  return (
    <li
      className={cn("flex items-center gap-1.5 rounded-sm px-1 py-px", isReward && "bg-selected font-semibold", !have && !isReward && "text-muted")}
    >
      <Icon
        icon={have ? CircleCheck : part.owned > 0 ? CircleDashed : Circle}
        size="xs"
        className={cn("shrink-0", have ? "text-success" : isReward ? "text-accent" : "text-faint")}
      />
      <span className="min-w-0 flex-1 truncate">
        {label}
        {part.needed > 1 && <span className="text-muted"> ×{part.needed}</span>}
        {isReward && <span className="sr-only">, this reward</span>}
      </span>
      <span className="tabular-nums">
        <span className="sr-only">{have ? "complete, " : "missing, "}</span>
        {part.owned}/{part.needed}
      </span>
    </li>
  );
}

function Card({ card, left, width, best }: { card: RewardCard; left: number; width: number; best: boolean }) {
  const setName = card.setName;
  const parts = card.components;
  const ownedFull = (card.completeSets ?? 0) >= 1;
  const doubtful = card.unknown || card.uncertain === true;
  const rewardPart = setName !== undefined ? shortName(card.name, setName) : undefined;
  const complete = parts?.filter((p) => p.owned >= p.needed).length ?? 0;
  const facts = [
    card.ducats !== undefined && card.ducats > 0 ? `${fmt(card.ducats)} ducats` : undefined,
    card.vaulted ? "Vaulted" : undefined,
  ].filter((f): f is string => f !== undefined);
  return (
    <article
      aria-label={[card.name, card.uncertain ? "uncertain" : "", best ? "best pick" : ""].filter(Boolean).join(", ")}
      className={cn("absolute top-7 flex flex-col gap-1.5 p-2.5", OVERLAY_PANEL, doubtful ? "border-warning" : best && OVERLAY_PANEL_HIGHLIGHT)}
      style={{ left, width }}
    >
      <header className="flex items-start justify-between gap-2">
        <h2 className="line-clamp-2 leading-tight font-semibold">
          {card.unknown ? "? " : ""}
          {card.name}
        </h2>
        {best && (
          <Badge tone="accent" variant="solid">
            Best pick
          </Badge>
        )}
      </header>
      {card.uncertain && (
        <Badge tone="warning" variant="outline" title="Read differently between reads, or only part of the name was read">
          Uncertain
        </Badge>
      )}
      {!card.unknown && (
        <div className="flex flex-wrap items-baseline gap-x-2">
          {card.plat !== undefined ? (
            <span
              className="text-lg leading-tight font-semibold text-tone tabular-nums"
              style={domainTone("price-platinum")}
              title={`${fmt(card.plat)} platinum`}
            >
              {fmt(card.plat)}p
            </span>
          ) : (
            <span className="text-lg leading-tight text-muted">—</span>
          )}
          {facts.length > 0 && <span className="text-xs text-muted">{facts.join(" · ")}</span>}
        </div>
      )}
      {parts && setName !== undefined && (
        <section className={cn("flex flex-col gap-1 border-t pt-1.5", OVERLAY_DIVIDER)}>
          <div className="flex items-center justify-between gap-1 text-xs">
            <span className={ownedFull ? "text-success" : "text-muted"}>
              {ownedFull ? "Full item owned" : `${String(complete)} of ${String(parts.length)} parts`}
            </span>
            <Plat value={(card.totalPlat ?? 0) > 0 ? card.totalPlat : undefined} />
          </div>
          <ul aria-label={`${setName} parts`} className="flex flex-col text-xs">
            {parts.map((p) => (
              <PartRow key={p.unique_name} part={p} setName={setName} isReward={shortName(p.name, setName) === rewardPart} />
            ))}
          </ul>
        </section>
      )}
      {card.category && <p className={OVERLAY_HEADING}>{card.category}</p>}
    </article>
  );
}

/** Why a read is not shown: the same list again, or fewer items than shown; null when it is shown. */
export function skipReason(prev: Session, rewards: RelicRewards): string | null {
  if (prev.source !== "live") return null;
  if (prev.paths.join(",") === rewards.items.join(",")) return "duplicate";
  if (prev.paths.length > 0 && rewards.items.length <= prev.paths.length)
    return `count guard (${String(rewards.items.length)}<=${String(prev.paths.length)})`;
  return null;
}

/** Live rewards replace a preview; a duplicate or shorter read keeps what is shown. */
export function nextSession(prev: Session, rewards: RelicRewards): Session {
  return skipReason(prev, rewards) === null ? { source: "live", paths: rewards.items, uncertain: rewards.uncertain ?? [] } : prev;
}

/**
 * The relic reward overlay window (relic-overlay, ?overlay): a card per reward
 * slot with prices and set progress, and an arrow over the best pick.
 * Transparent around the cards.
 */
export function RelicRewardOverlay() {
  const [session, setSession] = useState<Session>(IDLE);
  // What is shown now, for the session log (read outside the state updater).
  const shown = useRef(session);
  useEffect(() => {
    shown.current = session;
  }, [session]);
  const prefs = useOverlayPrefs();
  const width = useWindowWidth();

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
    const apply = (rewards: RelicRewards | null) => {
      if (!rewards || rewards.items.length === 0) {
        setSession(IDLE);
        void hideRewardStrip();
        return;
      }
      void logRelic(`[OV] rewards (${String(rewards.items.length)} items)`);
      const skip = skipReason(shown.current, rewards);
      if (skip) void logRelic(`[OV] rewards: ${skip}, skipping`);
      setSession((prev) => nextSession(prev, rewards));
    };
    keep(
      onEvent("relic-trigger", () => {
        setSession({ source: "live", paths: [], uncertain: [] });
      }),
    );
    keep(onEvent("relic-rewards", apply));
    keep(
      onEvent("relic-reward-preview", () => {
        setSession((prev) => (prev.source === "live" ? prev : { source: "preview", paths: [], uncertain: [] }));
      }),
    );
    keep(
      onEvent("relic-reward-preview-close", () => {
        setSession((prev) => (prev.source === "live" ? prev : IDLE));
        void hideRewardStrip();
      }),
    );
    keep(
      onEvent("overlays-disabled", () => {
        setSession(IDLE);
        void hideRewardStrip();
      }),
    );
    // Rewards that arrived before this window listened.
    void takePendingRewards().then((pending) => {
      if (!disposed && pending && pending.items.length > 0) apply(pending);
    });
    return () => {
      disposed = true;
      for (const fn of unlisteners) fn();
    };
  }, []);

  const backendCards = useRewardCards(session.paths);
  const names = useMemo(() => priceNames(cardsFrom(backendCards, NO_PRICES)), [backendCards]);
  const prices = useItemPrices(names);
  const live = useMemo(
    () => cardsFrom(backendCards, prices).map((card, i) => (session.uncertain[i] === true ? { ...card, uncertain: true } : card)),
    [backendCards, prices, session.uncertain],
  );

  // Each new set of rewards is a new view for the backend log.
  const view = useRef(0);
  useEffect(() => {
    view.current += 1;
  }, [session.paths]);
  // Prices arrive one by one; once the cards have been still for a moment,
  // tell the backend what they show.
  useEffect(() => {
    if (session.source !== "live" || live.length === 0 || !isTauri()) return;
    const timer = window.setTimeout(() => {
      void invoke("overlay_rendered", { overlay: "relic_reward", view: view.current, summary: rewardSummary(live) }).catch(() => undefined);
    }, 800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [session.source, live]);

  const cards = session.source === "preview" ? PREVIEW_CARDS : session.source === "live" ? live : [];
  if (cards.length === 0) return null;
  const best = bestPick(cards, prefs.rewardPriority);
  const centers = columnCenters(width, cards.length);
  const cw = cardWidth(width);
  return (
    <main aria-label="Relic rewards" className="relative h-full w-full">
      <h1 className="sr-only">Relic rewards</h1>
      {best >= 0 && (
        <svg
          aria-hidden="true"
          className="absolute top-0 size-6 text-accent"
          style={{ left: Math.round((centers[best] ?? width / 2) - 12) }}
          viewBox="0 0 24 20"
        >
          <polygon points="12,1 23,19 1,19" fill="currentColor" />
        </svg>
      )}
      {cards.map((card, i) => (
        <Card key={card.key} card={card} best={i === best} width={cw} left={Math.round((centers[i] ?? width / 2) - cw / 2)} />
      ))}
    </main>
  );
}
