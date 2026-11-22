import { ExternalLink, PanelRightOpen } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isTauri } from "../api/env";
import { closeModularPopout, openModularPopout, useModularPrefs } from "../api/modular";
import { useSettings } from "../api/settings";
import { clampModularWidth, MODULAR_WIDTH } from "../domain/modular";
import { ResizeHandle } from "../primitives/behavior/ResizeHandle";
import { IconButton } from "../primitives/actions";
import { Icon } from "../primitives/display";
import { toast } from "../primitives/overlay";
import { ModularWindow } from "../screens/modular/ModularWindow";

function subscribeResize(listener: () => void) {
  window.addEventListener("resize", listener);
  return () => {
    window.removeEventListener("resize", listener);
  };
}
const useWindowWidth = () => useSyncExternalStore(subscribeResize, () => window.innerWidth);
const NARROW_WINDOW_WIDTH = 720;

/**
 * The modular window docked on the right of the main window, or — with
 * modularPopout — in its own window, which this component opens and closes.
 */
export function ModularDock() {
  const { prefs, loaded, setWidth, setCollapsed, setPopout } = useModularPrefs();
  const { data: settings } = useSettings();
  const windowWidth = useWindowWidth();
  // Live width while dragging; saved once on release.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const widthCommit = useRef(0);
  const width = clampModularWidth(dragWidth ?? prefs.width, windowWidth);

  const popout = prefs.popout;
  useEffect(() => {
    if (!loaded || !isTauri()) return;
    if (!popout) {
      void closeModularPopout().catch(() => undefined);
      return;
    }
    openModularPopout(settings, width, () => {
      // The user closed the window: dock the panel again.
      setPopout(false);
    }).catch((error: unknown) => {
      setPopout(false);
      toast({ title: "Could not open the modular window", description: String(error), tone: "danger" });
    });
    // Only the switch opens or closes the window; width and settings are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popout, loaded]);

  if (popout) return null;
  if (windowWidth < NARROW_WINDOW_WIDTH) {
    return (
      <aside aria-label="Narrow modular window" className="flex w-12 shrink-0 justify-center border-s border-border bg-surface py-1.5">
        <IconButton
          size="sm"
          icon={ExternalLink}
          label="Open modular window in its own window"
          onClick={() => {
            setPopout(true);
          }}
        />
      </aside>
    );
  }
  if (prefs.collapsed) {
    return (
      <aside aria-label="Collapsed modular window" className="flex w-12 shrink-0 border-s border-border bg-surface">
        {/* The whole rail is the target and the vertical title says what it opens. The icon sits in a
            bottom strip as high as the open panel's collapse strip, so it stays in the same place. */}
        <button
          type="button"
          aria-label="Expand modular window"
          className="flex flex-1 flex-col items-center pt-2.5 text-muted hover:text-text"
          onClick={() => {
            setCollapsed(false);
          }}
        >
          <span className="text-sm font-semibold tracking-wide whitespace-nowrap uppercase [writing-mode:vertical-rl]">Modular window</span>
          <span className="mt-auto flex h-11 items-center">
            <Icon icon={PanelRightOpen} size="md" />
          </span>
        </button>
      </aside>
    );
  }
  return (
    <div className="relative flex shrink-0 border-s border-border" style={{ width }}>
      <ResizeHandle
        label="Modular window width"
        axis="x"
        direction={-1}
        value={width}
        min={MODULAR_WIDTH.min}
        max={clampModularWidth(MODULAR_WIDTH.max, windowWidth)}
        onValueChange={setDragWidth}
        onValueCommit={(value) => {
          const commit = ++widthCommit.current;
          // Keep the committed width visible until the asynchronous settings
          // save finishes; clearing it at once would show the previous width
          // until the optimistic settings cache catches up.
          setDragWidth(value);
          void setWidth(value).finally(() => {
            if (widthCommit.current === commit) setDragWidth(null);
          });
        }}
        className="absolute inset-y-0 start-0 z-(--ff-z-sticky) w-1.5"
      />
      <ModularWindow
        className="flex-1"
        onCollapse={() => {
          setCollapsed(true);
        }}
        onPopout={() => {
          setPopout(true);
        }}
      />
    </div>
  );
}
