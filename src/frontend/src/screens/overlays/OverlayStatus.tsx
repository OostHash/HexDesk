import { useEffect, useState } from "react";
import { isTauri } from "../../api/env";
import { onEvent, useEvent } from "../../api/events";
import { invoke } from "../../api/invoke";
import { ignoreCurrentWindowCursor, overlayPrefsFrom } from "../../api/overlays";
import { useSettings } from "../../api/settings";
import { FLOW_LABEL, type FlowKind } from "../../domain/testing";

/** Click-through status text centred above the game window. */
export function OverlayStatus() {
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<FlowKind | null>(null);
  const saved = useSettings();
  const settings = overlayPrefsFrom(saved.data).status;

  useEffect(() => {
    if (!isTauri() || !saved.isSuccess) return;
    let disposed = false;
    let clearTimer: number | undefined;
    let unlisten: (() => void) | undefined;
    void ignoreCurrentWindowCursor().catch(() => undefined);
    void onEvent("status-line", (next) => {
      if (!next || !settings.enabled) return;
      setText(next);
      void invoke("show_overlay_status_window").catch(() => undefined);
      window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => {
        setText("");
      }, settings.durationSeconds * 1000);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      window.clearTimeout(clearTimer);
      unlisten?.();
    };
  }, [saved.isSuccess, settings.durationSeconds, settings.enabled]);

  // The testing prompt shows even when the ordinary status line is off.
  useEvent("testing-feedback", (next) => {
    setFeedback(next.visible ? next.flow : null);
  });

  if (feedback) {
    return (
      <main aria-label="Testing feedback" className="flex h-full items-start justify-center pt-2 text-text">
        <div role="status" className="max-w-full rounded-md border border-accent/50 bg-bg/95 px-4 py-2 text-center shadow-2">
          <p className="font-semibold">Was the {FLOW_LABEL[feedback]} result correct?</p>
          <p className="mt-1 text-xs text-muted">
            <kbd className="font-semibold text-text">Page Up</kbd> correct · discard &nbsp; <kbd className="font-semibold text-text">Page Down</kbd>{" "}
            wrong · keep for report
          </p>
        </div>
      </main>
    );
  }
  if (!settings.enabled || !text) return null;
  return (
    <main aria-label="Overlay status" className="flex h-full items-start justify-center pt-2 text-text">
      <p role="status" className="max-w-full rounded-md border border-accent/40 bg-bg/95 px-3 py-1.5 text-center text-sm font-medium shadow-2">
        {text}
      </p>
    </main>
  );
}
