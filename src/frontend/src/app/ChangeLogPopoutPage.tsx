import { useEffect } from "react";
import { onWindowMovedOrResized, useGameState } from "../api/app";
import { saveChangelogGeometry } from "../api/changelogPopout";
import { isTauri } from "../api/env";
import { emitWith } from "../api/events";
import { useChangeLog } from "../api/inventory";
import { formatClockTime } from "../domain/changelog";
import type { ChangeEntry } from "../domain/inventory";
import { Button } from "../primitives/actions";
import { ChangeLogList, useRowContext } from "./ChangeLogDock";

const EMPTY: readonly ChangeEntry[] = [];
const GEOMETRY_DEBOUNCE_MS = 400;

/** Opens Inventory in the main window: on an item, or on recent changes (in a category). */
const openInventory = (payload: { item?: string; category?: string }) => {
  void emitWith("changelog-open-inventory", payload).catch(() => undefined);
};

/** The changelog in its own window: the full list with search; remembers where you put it. */
export function ChangeLogPopoutPage() {
  const changes = useChangeLog().data ?? EMPTY;
  const { scannedAt } = useGameState();
  const ctx = useRowContext(
    (item) => {
      openInventory({ item });
    },
    (category) => {
      openInventory({ category });
    },
  );

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let pending: number | undefined;
    void onWindowMovedOrResized(() => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        void saveChangelogGeometry().catch(() => undefined);
      }, GEOMETRY_DEBOUNCE_MS);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      window.clearTimeout(pending);
      unlisten?.();
    };
  }, []);

  return (
    <main className="flex h-full min-h-0 flex-col bg-panel">
      <h1 className="sr-only">Changelog</h1>
      <div className="flex min-h-control-md shrink-0 items-center gap-3 border-b border-border px-3">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">Changelog</span>
        <span className="text-xs text-muted">last scan {scannedAt === null ? "not yet" : formatClockTime(scannedAt, ctx.clock, ctx.locale)}</span>
        <Button
          size="sm"
          variant="ghost"
          className="ms-auto shrink-0"
          onClick={() => {
            openInventory({});
          }}
        >
          Show in Inventory
        </Button>
      </div>
      <ChangeLogList changes={changes} ctx={ctx} />
    </main>
  );
}
