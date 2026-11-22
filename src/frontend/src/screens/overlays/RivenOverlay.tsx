import { RefreshCw, Save, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauri } from "../../api/env";
import { emitEvent, onEvent } from "../../api/events";
import { invoke } from "../../api/invoke";
import { fitRivenWidth, hideCurrentWindow, requestRivenCheck } from "../../api/overlays";
import { useRollActions } from "../../api/rivens";
import {
  classifyOriginal,
  classifyStat,
  PREVIEW_VIEW,
  RIVEN_WIDTH,
  rivenSummary,
  savedRollLabel,
  STAT_LABEL,
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
import { Badge, ProgressBar, type Tone } from "../../primitives/display";

const VERDICT_TONE: Readonly<Record<VerdictLevel, Tone>> = { great: "success", good: "info", mediocre: "warning", bad: "danger" };
const scoreTone = (score: number): Tone => (score >= 0.8 ? "success" : score >= 0.6 ? "info" : score >= 0.4 ? "warning" : "danger");
const STAT_TONE: Readonly<Record<StatClass, Tone>> = { wanted: "success", neutral: "neutral", safe: "info", harmful: "danger" };

function StatRow({ stat, cls, faded = false }: { stat: RollStat; cls: StatClass; faded?: boolean }) {
  return (
    <li className={cn("flex items-center gap-2 rounded-sm px-1.5 py-0.5 text-xs", faded && "opacity-75")}>
      <Badge tone={STAT_TONE[cls]} className="w-16 justify-center">
        {STAT_LABEL[cls]}
      </Badge>
      <span className="flex-1">{stat.name}</span>
      <span className="font-semibold tabular-nums">{stat.value}</span>
    </li>
  );
}

function Analysis({ analysis }: { analysis: OverlayAnalysis }) {
  const several = analysis.alternatives.length > 1;
  return (
    <>
      {analysis.alternatives.map((alt, i) => (
        <section
          key={alt.label}
          aria-label={several ? alt.label : "Analysis"}
          className={cn("flex flex-col gap-1", i > 0 && "border-t border-border/50 pt-1.5")}
        >
          {several && <span className="text-xs font-semibold text-muted uppercase">{alt.label}</span>}
          <Badge tone={VERDICT_TONE[verdictLevel(alt.verdict)]} size="md" className="self-start">
            {alt.verdict}
          </Badge>
          <ProgressBar
            value={Math.round(alt.score * 100)}
            max={100}
            label={`${String(Math.round(alt.score * 100))}%`}
            name={several ? `${alt.label} score` : "Score"}
            tone={scoreTone(alt.score)}
          />
          {i === 0 && (analysis.safe_negatives_present.length > 0 || analysis.harmful_negatives.length > 0) && (
            <ul aria-label="Negatives" className="flex flex-col gap-0.5">
              {analysis.safe_negatives_present.map((s) => (
                <StatRow key={s} stat={{ name: `−${s}`, value: "", positive: false }} cls="safe" />
              ))}
              {analysis.harmful_negatives.map((s) => (
                <StatRow key={s} stat={{ name: `−${s}`, value: "", positive: false }} cls="harmful" />
              ))}
            </ul>
          )}
          {alt.missing.length > 0 && (
            <p className="text-xs text-muted">
              <span className="font-semibold">Wanted: </span>
              {alt.missing.join(", ")}
            </p>
          )}
        </section>
      ))}
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
      <div className="flex w-full flex-col gap-2 rounded-lg border border-accent/30 bg-bg/95 px-3.5 py-3 text-sm text-text shadow-3">
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
            {stats.length > 0 && (
              <section aria-label={result.isComparison ? "New roll" : "Rolled stats"} className="flex flex-col gap-1 border-t border-border/50 pt-2">
                {result.isComparison && <h2 className="text-xs font-semibold text-muted uppercase">New roll</h2>}
                <ul className="flex flex-col gap-0.5">
                  {stats.map((s, i) => (
                    <StatRow key={`${s.name}-${String(i)}`} stat={s} cls={classifyStat(s, analysis)} />
                  ))}
                </ul>
              </section>
            )}
            {result.isComparison && result.originalStats.length > 0 && (
              <section aria-label="Original roll" className="flex flex-col gap-1 border-t border-border/50 pt-1.5">
                <h2 className="text-xs font-semibold text-muted uppercase">Original roll</h2>
                <ul className="flex flex-col gap-0.5">
                  {result.originalStats.map((s, i) => (
                    <StatRow key={`${s.name}-${String(i)}`} stat={s} cls={classifyOriginal(s, analysis, wanted)} faded />
                  ))}
                </ul>
              </section>
            )}
            {!analysis && stats.length > 0 && <p className="border-t border-border/50 pt-1.5 text-xs text-muted">No database entry for {title}</p>}
            {analysis?.notes && <p className="border-t border-border/50 pt-1.5 text-xs text-muted italic">{analysis.notes}</p>}
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
