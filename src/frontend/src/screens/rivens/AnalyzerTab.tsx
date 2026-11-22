import { CircleCheck, CircleDashed, ExternalLink, Info, RefreshCw, ScanSearch, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "../../api/env";
import { onEvent } from "../../api/events";
import { openExternal } from "../../api/links";
import { requestRivenCheck } from "../../api/overlays";
import { useRivenAnalysis, useRivenWeapons, useRollActions } from "../../api/rivens";
import {
  ALL_STATS,
  filledStats,
  rollLabel,
  splitSigns,
  titleCase,
  toggleRollStat,
  weaponSuggestions,
  type RivenAnalysis,
  type RollStat,
} from "../../domain/rivens";
import { Button, IconButton } from "../../primitives/actions";
import { Badge, Card, Chip, ProgressBar } from "../../primitives/display";
import { ComboBox, Input } from "../../primitives/forms";
import { toast } from "../../primitives/overlay";
import { SavedRolls } from "./SavedRolls";
import { VerdictBadge, scoreTone } from "./verdict";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1zbaeJBuBn44cbVKzJins_E3hTDpnmvOk8heYN-G8yy8";

function StatEditor({ stat, onChange }: { stat: RollStat; onChange: (s: RollStat) => void }) {
  return (
    <li className="flex items-center gap-2">
      <Button
        size="sm"
        variant={stat.positive ? "secondary" : "danger"}
        aria-label={stat.positive ? `${stat.name} is positive; make it negative` : `${stat.name} is negative; make it positive`}
        onClick={() => {
          onChange({ ...stat, positive: !stat.positive });
        }}
        className="w-8 justify-center"
      >
        {stat.positive ? "+" : "−"}
      </Button>
      <span className="min-w-40 flex-1 text-sm">{stat.name}</span>
      <Input
        size="sm"
        inputMode="decimal"
        aria-label={`${stat.name} value`}
        placeholder={stat.useMultiplier ? "e.g. 0.88" : "e.g. 85"}
        value={stat.value}
        onChange={(e) => {
          onChange({ ...stat, value: e.target.value });
        }}
        className="w-24 text-end"
      />
      <Button
        size="sm"
        variant="ghost"
        aria-label={stat.useMultiplier ? `${stat.name} as multiplier; switch to percent` : `${stat.name} as percent; switch to multiplier`}
        onClick={() => {
          onChange({ ...stat, useMultiplier: !stat.useMultiplier });
        }}
        className="w-8 justify-center"
      >
        {stat.useMultiplier ? "×" : "%"}
      </Button>
    </li>
  );
}

function AnalysisView({ analysis }: { analysis: RivenAnalysis }) {
  const several = analysis.alternatives.length > 1;
  return (
    <section aria-label="Analysis" className="flex flex-col gap-2">
      {analysis.alternatives.map((alt, i) => (
        <Card key={alt.label} as="article" padding="sm" className="flex flex-col gap-2">
          <header className="flex flex-wrap items-center gap-2">
            {several && <Badge variant="outline">{alt.label}</Badge>}
            <VerdictBadge verdict={alt.verdict} />
          </header>
          <ProgressBar
            value={Math.round(alt.score * 100)}
            max={100}
            label={`${String(Math.round(alt.score * 100))}%`}
            name={several ? `${alt.label} score` : "Score"}
            tone={scoreTone(alt.score)}
          />
          <ul className="flex flex-col gap-1 text-sm">
            {alt.matched.map((s) => (
              <li key={`m-${s}`} className="flex items-center gap-2 text-success">
                <CircleCheck aria-hidden="true" className="size-4" />
                {s}
                <Badge tone="success" className="ms-auto">
                  Wanted
                </Badge>
              </li>
            ))}
            {alt.missing.map((s) => (
              <li key={`x-${s}`} className="flex items-center gap-2 text-muted">
                <CircleDashed aria-hidden="true" className="size-4" />
                {s}
                <Badge className="ms-auto">Not rolled</Badge>
              </li>
            ))}
            {i === 0 &&
              analysis.safe_negatives_present.map((s) => (
                <li key={`s-${s}`} className="flex items-center gap-2 text-info">
                  <ShieldCheck aria-hidden="true" className="size-4" />−{s}
                  <Badge tone="info" className="ms-auto">
                    Safe negative
                  </Badge>
                </li>
              ))}
            {i === 0 &&
              analysis.harmful_negatives.map((s) => (
                <li key={`h-${s}`} className="flex items-center gap-2 text-danger">
                  <TriangleAlert aria-hidden="true" className="size-4" />−{s}
                  <Badge tone="danger" className="ms-auto">
                    Harmful
                  </Badge>
                </li>
              ))}
          </ul>
        </Card>
      ))}
      {analysis.notes && (
        <p className="flex items-start gap-2 border-t border-border pt-2 text-xs text-muted">
          <Info aria-hidden="true" className="size-4 shrink-0" />
          {analysis.notes}
        </p>
      )}
    </section>
  );
}

/** Rate a riven roll for a weapon and keep the good ones. */
export function AnalyzerTab() {
  const weapons = useRivenWeapons();
  const actions = useRollActions();
  const [typed, setTyped] = useState("");
  const [weapon, setWeapon] = useState("");
  const [stats, setStats] = useState<RollStat[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { positives, negatives } = useMemo(() => splitSigns(stats), [stats]);
  const analysis = useRivenAnalysis(weapon, positives, negatives);
  const result = weapon && stats.length > 0 ? (analysis.data ?? null) : null;

  // A riven unveiled in game: get ready for the next roll.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void onEvent("riven-unveiled", () => {
      inputRef.current?.focus();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const options = useMemo(() => weaponSuggestions(weapons.data ?? [], typed).map((w) => ({ id: w, label: titleCase(w) })), [weapons.data, typed]);
  const status = weapons.reload.isPending
    ? "Reloading…"
    : weapons.isError
      ? "Could not load the riven database. Try reloading it."
      : weapons.data
        ? `${String(weapons.data.length)} weapons loaded`
        : "Loading the riven database…";

  const save = () => {
    const filled = filledStats(stats);
    if (filled.length === 0) {
      toast({ title: "Add stat values before saving.", tone: "warning" });
      return;
    }
    actions.save.mutate(
      { replaceId: null, weapon, label: rollLabel(weapon, new Date()), stats: filled, verdict: result?.verdict ?? "", score: result?.score ?? 0 },
      {
        onSuccess: () => toast({ title: "Roll saved", tone: "success" }),
        onError: (e) => toast({ title: "Could not save the roll", description: e.message, tone: "danger" }),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          leadingIcon={ScanSearch}
          title="Read the riven card on the Warframe screen"
          onClick={() => void requestRivenCheck()}
        >
          Check Riven
        </Button>
        <p aria-live="polite" className="text-xs text-muted">
          {status}
        </p>
        <span className="ms-auto flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" trailingIcon={ExternalLink} onClick={() => void openExternal(SHEET_URL)}>
            Data by 44bananas
          </Button>
          <IconButton
            icon={RefreshCw}
            size="sm"
            label="Reload the riven database"
            disabled={weapons.reload.isPending}
            onClick={() => {
              weapons.reload.mutate(undefined, { onError: () => toast({ title: "Reload failed", tone: "danger" }) });
            }}
          />
        </span>
      </div>

      <ComboBox
        label="Weapon"
        placeholder="Type a weapon name…"
        inputValue={typed}
        inputRef={inputRef}
        onInputChange={(value) => {
          setTyped(value);
          if (value.toLowerCase() !== weapon) setWeapon("");
        }}
        options={options}
        onSelect={(w) => {
          setWeapon(w);
          setTyped(titleCase(w));
          setStats([]);
        }}
        className="max-w-md"
      />

      {weapon && (
        <>
          <div role="group" aria-label="Stats rolled" className="flex flex-col gap-2">
            <p className="text-xs text-muted">Stats rolled — choose them here, then set + or − and the value below.</p>
            <div className="flex flex-wrap gap-1">
              {ALL_STATS.map((name) => (
                <Chip
                  key={name}
                  active={stats.some((s) => s.name === name)}
                  onActiveChange={() => {
                    setStats(toggleRollStat(stats, name));
                  }}
                >
                  {name}
                </Chip>
              ))}
            </div>
          </div>

          {stats.length > 0 && (
            <Card as="section" padding="sm" className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Stat values</h3>
              <ul className="flex flex-col gap-1.5">
                {stats.map((s) => (
                  <StatEditor
                    key={s.name}
                    stat={s}
                    onChange={(next) => {
                      setStats(stats.map((x) => (x.name === s.name ? next : x)));
                    }}
                  />
                ))}
              </ul>
              <div>
                <Button size="sm" variant="primary" loading={actions.save.isPending} onClick={save}>
                  Save roll
                </Button>
              </div>
            </Card>
          )}

          {result && <AnalysisView analysis={result} />}

          <div>
            <Button
              onClick={() => {
                setStats([]);
              }}
            >
              Next roll
            </Button>
          </div>
        </>
      )}

      <SavedRolls />
    </div>
  );
}
