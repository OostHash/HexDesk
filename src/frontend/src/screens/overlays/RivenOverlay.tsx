import { ArrowDown, ArrowUp, Check, Equal, RefreshCw, Save, TriangleAlert, X, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauri } from "../../api/env";
import { emitEvent, onEvent } from "../../api/events";
import { invoke } from "../../api/invoke";
import { fitRivenWidth, hideCurrentWindow, requestRivenCheck } from "../../api/overlays";
import { useRollActions } from "../../api/rivens";
import {
  classifyOriginal,
  classifyStat,
  compareRolls,
  PREVIEW_VIEW,
  RIVEN_WIDTH,
  rivenSummary,
  savedRollLabel,
  STAT_LABEL,
  verdictText,
  wantedNames,
  weaponTitle,
  type OverlayAnalysis,
  type RivenView,
  type StatClass,
} from "../../domain/rivenOverlay";
import { getPreferences } from "../../state/preferences";
import { verdictLevel, type RollStat, type VerdictLevel } from "../../domain/rivens";
import { Button, IconButton } from "../../primitives/actions";
import { cn } from "../../primitives/cn";
import { Badge, Icon, ProgressBar, type Tone } from "../../primitives/display";
import { OVERLAY_HEADING, OVERLAY_PANEL } from "./overlayStyles";

const VERDICT_TONE: Readonly<Record<VerdictLevel, Tone>> = { great: "success", good: "success", mediocre: "warning", bad: "danger" };

/** How each kind of stat looks: an icon for the two that matter, plain words for the rest. */
const STAT_LOOK: Readonly<Record<StatClass, { icon?: LucideIcon; className: string }>> = {
  wanted: { icon: Check, className: "text-success" },
  neutral: { className: "text-muted" },
  safe: { className: "text-muted" },
  harmful: { icon: TriangleAlert, className: "text-danger" },
};

/** One stat: name and value first, then what it means for this weapon. */
function StatRow({ stat, cls, judged }: { stat: RollStat; cls: StatClass; judged: boolean }) {
  const look = STAT_LOOK[cls];
  return (
    <li className="grid grid-cols-[1fr_auto_5.5rem] items-center gap-2 py-0.5">
      <span className={cn("truncate", cls === "wanted" && "font-semibold")}>{stat.name}</span>
      <span className={cn("text-end tabular-nums", cls === "wanted" && "font-semibold")}>{stat.value}</span>
      {judged ? (
        <span className={cn("inline-flex items-center gap-1 text-xs", look.className)}>
          {look.icon && <Icon icon={look.icon} size="xs" />}
          {STAT_LABEL[cls]}
        </span>
      ) : (
        <span />
      )}
    </li>
  );
}

const COMPARISON: Readonly<Record<"better" | "same" | "worse", { icon: LucideIcon; className: string; text: string }>> = {
  better: { icon: ArrowUp, className: "border-success text-success", text: "New roll is better" },
  same: { icon: Equal, className: "border-border text-muted", text: "Both rolls are even" },
  worse: { icon: ArrowDown, className: "border-danger text-danger", text: "Original roll is better" },
};

/** New against original roll, counted in wanted stats. */
function RollComparison({ newWanted, originalWanted }: { newWanted: number; originalWanted: number }) {
  const look = COMPARISON[compareRolls(newWanted, originalWanted)];
  return (
    <div className={cn("flex flex-col rounded-md border px-2 py-1", look.className)}>
      <p className="flex items-center gap-1.5 font-semibold">
        <Icon icon={look.icon} size="xs" />
        {look.text}
      </p>
      <p className="text-xs text-muted">
        Wanted stats: new {newWanted}, original {originalWanted}
      </p>
    </div>
  );
}

/**
 * Every stat this build wants, so the player need not look it up: a check
 * when the roll has it, grey when it is still missing. A missing entry can
 * be a choice ("Multishot / Toxin").
 */
function WantedStats({ matched, missing }: { matched: readonly string[]; missing: readonly string[] }) {
  if (matched.length + missing.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h2 className={OVERLAY_HEADING}>Wanted stats</h2>
      <ul aria-label="Wanted stats" className="flex flex-wrap gap-1">
        {matched.map((name) => (
          <li key={name}>
            <Badge tone="success" icon={Check}>
              {name}
              <span className="sr-only">, on this roll</span>
            </Badge>
          </li>
        ))}
        {missing.map((name) => (
          <li key={name}>
            <Badge variant="outline">
              {name}
              <span className="sr-only">, missing</span>
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Analysis({ analysis }: { analysis: OverlayAnalysis }) {
  const several = analysis.alternatives.length > 1;
  return (
    <>
      {analysis.alternatives.map((alt, i) => {
        const pct = Math.round(alt.score * 100);
        const tone = VERDICT_TONE[verdictLevel(alt.verdict)];
        return (
          <section
            key={alt.label}
            aria-label={several ? alt.label : "Analysis"}
            className={cn("flex flex-col gap-1", i > 0 && "border-t border-border pt-1.5")}
          >
            {several && <span className={OVERLAY_HEADING}>{alt.label}</span>}
            <p className="flex items-baseline gap-2">
              <span className="text-xl leading-tight font-semibold tabular-nums">{pct}%</span>
              <span className="text-muted">roll score</span>
            </p>
            <ProgressBar value={pct} max={100} label={verdictText(alt.verdict)} name={several ? `${alt.label} score` : "Score"} tone={tone} />
            <WantedStats matched={alt.matched} missing={alt.missing} />
          </section>
        );
      })}
    </>
  );
}

/** A live view keeps a Settings preview from replacing it. */
const isLive = (view: RivenView | null) => view !== null && !(view.kind === "result" && view.preview);

/**
 * The riven overlay window (riven-overlay, #rivenoverlay): what the check read
 * from the riven card and how good the roll is. The backend runs the check,
 * places and hides the window; this one draws the view it is sent and
 * confirms what it drew.
 */
export function RivenOverlay() {
  const [view, setView] = useState<RivenView | null>(null);
  const [saved, setSaved] = useState(false);
  const { save } = useRollActions();

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
    keep(onEvent("riven-view", setView));
    keep(
      onEvent("riven-preview", () => {
        setView((prev) => (isLive(prev) ? prev : PREVIEW_VIEW));
      }),
    );
    keep(
      onEvent("riven-preview-close", () => {
        setView((prev) => {
          if (isLive(prev)) return prev;
          void hideCurrentWindow();
          return null;
        });
      }),
    );
    return () => {
      disposed = true;
      for (const fn of unlisteners) fn();
    };
  }, []);

  // Each live view carries its number; the backend logs that it was drawn.
  useEffect(() => {
    if (!view || !isTauri()) return;
    void fitRivenWidth(Math.round(RIVEN_WIDTH * getPreferences().textScale)).catch(() => undefined);
    if (view.view === undefined) return;
    void invoke("overlay_rendered", { overlay: "riven", view: view.view, summary: rivenSummary(view) }).catch(() => undefined);
  }, [view]);

  useEffect(() => {
    if (!saved) return;
    const id = window.setTimeout(() => {
      setSaved(false);
    }, 2000);
    return () => {
      window.clearTimeout(id);
    };
  }, [saved]);

  const result = view?.kind === "result" ? view : null;
  const analysis = result?.analysis ?? null;
  const weapon = analysis?.weapon ?? result?.weapon ?? "";
  const title = weaponTitle(weapon);
  const stats = result?.rolledStats ?? [];
  const wanted = wantedNames(analysis);

  return (
    <main aria-label="Riven check" className="flex h-full w-full items-start justify-center p-2">
      <div className={cn("flex w-full flex-col gap-2 px-3.5 py-3", OVERLAY_PANEL)}>
        <header className="flex items-center gap-1">
          <h1 className="flex-1 truncate font-semibold">{title}</h1>
          <Button
            size="sm"
            leadingIcon={result?.isComparison ? RefreshCw : Zap}
            onClick={() => void requestRivenCheck()}
            title="Check the riven on screen again (after cycling, for a comparison)"
          >
            {result?.isComparison ? "Refresh" : "New roll"}
          </Button>
          {stats.length > 0 && result && (
            <IconButton
              size="sm"
              icon={Save}
              label={saved ? "Roll saved" : "Save this roll"}
              disabled={save.isPending}
              onClick={() => {
                save.mutate(
                  {
                    replaceId: null,
                    weapon,
                    label: savedRollLabel(weapon, result.rollCount, new Date()),
                    stats,
                    verdict: analysis?.verdict ?? "",
                    score: analysis?.score ?? 0,
                  },
                  {
                    onSuccess: () => {
                      setSaved(true);
                      void emitEvent("riven-roll-saved");
                    },
                  },
                );
              }}
            />
          )}
          <IconButton
            size="sm"
            icon={X}
            label="Close riven check"
            onClick={() => {
              if (isLive(view)) {
                void invoke("overlay_closed").catch(() => undefined);
              } else {
                setView(null);
                void hideCurrentWindow();
              }
            }}
          />
        </header>
        {saved && (
          <p role="status" className="text-xs text-success">
            Roll saved.
          </p>
        )}

        {(!view || view.kind === "scanning") && <p className="py-1.5 text-center text-xs text-muted">Scanning stats…</p>}

        {result && stats.length === 0 && !analysis && (
          <p className="py-1.5 text-center text-xs text-danger">
            Could not read card stats
            {result.weapon && <span className="mt-1 block text-muted">Weapon: “{result.weapon}”</span>}
          </p>
        )}

        {result && (stats.length > 0 || analysis) && (
          <>
            {analysis && <Analysis analysis={analysis} />}
            {analysis && result.isComparison && result.originalStats.length > 0 && (
              <RollComparison
                newWanted={stats.filter((s) => classifyStat(s, analysis) === "wanted").length}
                originalWanted={result.originalStats.filter((s) => classifyOriginal(s, analysis, wanted) === "wanted").length}
              />
            )}
            {stats.length > 0 && (
              <section aria-label={result.isComparison ? "New roll" : "Rolled stats"} className="flex flex-col gap-1 border-t border-border pt-2">
                {result.isComparison && <h2 className={OVERLAY_HEADING}>New roll</h2>}
                <ul className="flex flex-col">
                  {stats.map((s, i) => (
                    <StatRow key={`${s.name}-${String(i)}`} stat={s} cls={classifyStat(s, analysis)} judged={analysis !== null} />
                  ))}
                </ul>
              </section>
            )}
            {result.isComparison && result.originalStats.length > 0 && (
              <section aria-label="Original roll" className="flex flex-col gap-1 border-t border-border pt-1.5">
                <h2 className={OVERLAY_HEADING}>Original roll</h2>
                <ul className="flex flex-col">
                  {result.originalStats.map((s, i) => (
                    <StatRow key={`${s.name}-${String(i)}`} stat={s} cls={classifyOriginal(s, analysis, wanted)} judged={analysis !== null} />
                  ))}
                </ul>
              </section>
            )}
            {!analysis && stats.length > 0 && <p className="border-t border-border pt-1.5 text-xs text-muted">No database entry for {title}</p>}
            {analysis?.notes && <p className="border-t border-border pt-1.5 text-xs text-muted italic">{analysis.notes}</p>}
            {!analysis && result.ocrRaw && (
              <details className="mt-1 text-xs text-muted">
                <summary className="cursor-pointer">Raw OCR</summary>
                <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap">{result.ocrRaw}</pre>
              </details>
            )}
          </>
        )}
      </div>
    </main>
  );
}
