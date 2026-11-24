import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

const buttonClass = "grid h-8 w-11 place-items-center text-muted transition-colors hover:bg-hover hover:text-text focus-visible:-outline-offset-2";

/** Empty draggable title bar with native-window controls and no duplicate branding. */
export function WindowTitleBar() {
  return (
    <div data-tauri-drag-region className="flex h-8 shrink-0 select-none justify-end border-b border-border bg-panel">
      <button
        type="button"
        className={buttonClass}
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => {
          void getCurrentWindow()
            .minimize()
            .catch(() => undefined);
        }}
      >
        <Minus aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
      </button>
      <button
        id="window-maximize-button"
        type="button"
        className={buttonClass}
        aria-label="Maximize or restore window"
        title="Maximize or restore"
        onClick={() => {
          void getCurrentWindow()
            .toggleMaximize()
            .catch(() => undefined);
        }}
      >
        <Square aria-hidden="true" className="size-3" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className={`${buttonClass} hover:bg-danger hover:text-on-danger`}
        aria-label="Close window"
        title="Close"
        onClick={() => {
          void getCurrentWindow()
            .close()
            .catch(() => undefined);
        }}
      >
        <X aria-hidden="true" className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
