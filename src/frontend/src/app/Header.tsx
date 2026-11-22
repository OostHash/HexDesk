import { FileArchive } from "lucide-react";
import { useEffect, useState } from "react";
import { pokeScan, refreshAllCaches, useBlobStatus, useCacheStatuses, useGameState, useMonitorStatus, usePlayer } from "../api/app";
import { useOverlayStatus } from "../api/overlays";
import { useSettings } from "../api/settings";
import { useDiscardTestReport, useExportTestReport, useTestReportFlows } from "../api/testReport";
import { useSession } from "../api/trading";
import { useNow } from "../state/useNow";
import { cacheAge, cacheHealth, cacheLabel, sourceTone } from "../domain/cache";
import { memoryStatus, POKE_MS, wfmStatus } from "../domain/status";
import { StatusChip } from "../patterns/StatusChip";
import { Button } from "../primitives/actions";
import { Badge } from "../primitives/display";
import { Popover, toast } from "../primitives/overlay";

/** Stays a little after "Refresh all data". */
const REFRESH_FEEDBACK_MS = 2000;

type Props = {
  /** Opens a screen of the shell (WFM chip → Market, which opens on Trading). */
  onOpenScreen: (id: string) => void;
  /** Opens Settings when the Memory status is disabled. */
  onOpenSettings: () => void;
};

/**
 * Top bar of the main window: account, a waiting test report and status chips. An available update shows on Settings
 * instead.
 */
export function Header({ onOpenScreen, onOpenSettings }: Props) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
      <Account />
      <div className="ms-auto flex flex-wrap items-center gap-1.5">
        <OverlayStatus />
        <MemoryChip onOpenSettings={onOpenSettings} />
        <WfmChip onOpenScreen={onOpenScreen} />
        <DataChip />
      </div>
    </header>
  );
}

function Account() {
  const { name, masteryRank } = usePlayer();
  const blob = useBlobStatus();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {masteryRank !== null && (
        <Badge tone="accent" variant="outline" title="Mastery Rank">
          MR {masteryRank}
        </Badge>
      )}
      {name && (
        <Badge variant="outline" title="Logged-in Warframe account">
          {name}
        </Badge>
      )}
      {blob?.stage === "done" && (
        <Badge tone="success" variant="outline" title={blob.detail}>
          Inventory loaded
        </Badge>
      )}
      <TestReport />
    </div>
  );
}

/** Players see screens; one reported flow is one answer about one screen. */
const flowCount = (flows: number) => `${String(flows)} ${flows === 1 ? "screen" : "screens"}`;

/**
 * Flows marked wrong during opt-in testing, shown until the player exports or discards them. Only the player decides
 * when the report is written.
 */
function TestReport() {
  const flows = useTestReportFlows();
  const exporting = useExportTestReport();
  const discarding = useDiscardTestReport();
  const [confirming, setConfirming] = useState(false);
  if (flows === 0) return null;
  const busy = exporting.isPending || discarding.isPending;
  return (
    <Popover
      label="Test report"
      placement="bottom"
      className="w-72"
      onOpenChange={() => {
        setConfirming(false);
      }}
      trigger={(props) => (
        <button type="button" title="Screens you marked wrong, ready to export" className="rounded-sm" {...props}>
          <Badge tone="warning" variant="outline" icon={FileArchive}>
            Test report · {flowCount(flows)}
          </Badge>
        </button>
      )}
    >
      {confirming ? (
        <>
          <p>Discard {flowCount(flows)} without saving a report? This cannot be undone.</p>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={discarding.isPending}
              disabled={busy}
              onClick={() => {
                discarding.mutate(undefined, {
                  onError: (error) => {
                    toast({ title: "Could not discard the test report", description: String(error), tone: "danger" });
                  },
                });
              }}
            >
              Discard
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>
            {flowCount(flows)} marked wrong. Export them as one zip in Downloads to share in the HexDesk Discord or on GitHub. Nothing is uploaded
            automatically.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setConfirming(true);
              }}
            >
              Discard…
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={exporting.isPending}
              disabled={busy}
              onClick={() => {
                exporting.mutate(undefined, {
                  onSuccess: (path) => {
                    toast({ title: "Test report saved", description: path, tone: "success" }, { timeout: 10_000 });
                  },
                  onError: (error) => {
                    toast({
                      title: "Could not save the test report",
                      description: `${String(error)} The screens you marked wrong were kept.`,
                      tone: "danger",
                    });
                  },
                });
              }}
            >
              {exporting.isPending ? "Exporting…" : "Export to Downloads"}
            </Button>
          </div>
        </>
      )}
    </Popover>
  );
}

/** Backend status line (status-line), shown for a few seconds. */
function OverlayStatus() {
  const text = useOverlayStatus();
  // display: contents — the live region takes no space (or flex gap) while empty.
  return (
    <span role="status" className="contents">
      {text && <StatusChip label="Overlay" detail={text} state="online" hint="Overlay status" />}
    </span>
  );
}

function MemoryChip({ onOpenSettings }: Pick<Props, "onOpenSettings">) {
  const { data: settings } = useSettings();
  const monitoring = useMonitorStatus().data === true;
  const { running } = useGameState();
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!checking) return;
    const id = window.setTimeout(() => {
      setChecking(false);
    }, POKE_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [checking]);

  const status = memoryStatus({ enabled: settings?.memoryScannerEnabled === true, monitoring, gameRunning: running, checking });
  return (
    <StatusChip
      label="Memory"
      state={status.state}
      detail={status.detail}
      hint={status.hint}
      onClick={
        status.state === "disabled"
          ? onOpenSettings
          : status.canPoke
            ? () => {
                setChecking(true);
                void pokeScan().catch(() => undefined);
              }
            : undefined
      }
    />
  );
}

function WfmChip({ onOpenScreen }: Pick<Props, "onOpenScreen">) {
  const { data: session } = useSession();
  const status = wfmStatus(session != null);
  return (
    <StatusChip
      label="WFM"
      state={status.state}
      detail={status.detail}
      hint={status.hint}
      onClick={
        session == null
          ? () => {
              onOpenScreen("market");
            }
          : undefined
      }
    />
  );
}

const HEALTH = {
  fresh: { state: "online", detail: "fresh" },
  stale: { state: "warn", detail: "stale" },
  offline: { state: "offline", detail: "offline" },
} as const;

function DataChip() {
  const statuses = useCacheStatuses();
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  // Ages tick only while the panel is open.
  const now = useNow(open);
  const health = HEALTH[cacheHealth(statuses)];
  const entries = Object.entries(statuses);
  return (
    <Popover
      label="Data caches"
      placement="bottom-end"
      onOpenChange={setOpen}
      className="w-64"
      trigger={(props) => <StatusChip label="Data" state={health.state} detail={health.detail} hint="Data cache status" {...props} />}
    >
      {entries.length === 0 ? (
        <p className="text-muted">No cache data yet</p>
      ) : (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5">
          {entries.map(([key, status]) => (
            <div key={key} className="contents">
              <dt className="font-medium">{cacheLabel(key)}</dt>
              <dd className="text-end">
                <Badge tone={sourceTone(status.source)} title={status.warning ?? undefined}>
                  {status.source} · {cacheAge(status.last_updated, now)}
                </Badge>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Button
        variant="primary"
        size="sm"
        className="mt-3 w-full"
        loading={refreshing}
        disabled={refreshing}
        onClick={() => {
          setRefreshing(true);
          void refreshAllCaches()
            .catch(() => undefined)
            .finally(() => {
              window.setTimeout(() => {
                setRefreshing(false);
              }, REFRESH_FEEDBACK_MS);
            });
        }}
      >
        {refreshing ? "Refreshing…" : "Refresh all data"}
      </Button>
    </Popover>
  );
}
