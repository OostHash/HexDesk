import { CircleAlert, CircleCheck } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { isTauri } from "../../api/env";
import { onEvent, useEvent, type EventMap } from "../../api/events";
import { invoke } from "../../api/invoke";
import { fitWindowHeight, ignoreCurrentWindowCursor, overlayPrefsFrom } from "../../api/overlays";
import { useSettings } from "../../api/settings";
import { keyLabel, type TestingKeys } from "../../domain/overlayKey";
import { Icon, ProgressBar } from "../../primitives/display";
import { FLOW_LABEL, type FlowKind } from "../../domain/testing";
import { usePreferences } from "../../state/preferences";
import { cn } from "../../primitives/cn";
import { OVERLAY_PANEL } from "./overlayStyles";

/** Click-through status text centred above the game window. */
export function OverlayStatus() {
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<{ flow: FlowKind; until: number; timeoutMs: number } | null>(null);
  const saved = useSettings();
  const prefs = overlayPrefsFrom(saved.data);
  const settings = prefs.status;

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

  // The testing prompt and its confirmations show even when the ordinary status line is off.
  useEvent("testing-feedback", (next) => {
    setFeedback(next.visible ? { flow: next.flow, timeoutMs: next.timeoutMs, until: Date.now() + next.timeoutMs } : null);
  });
  const [notice, setNotice] = useState<EventMap["testing-notice"] | null>(null);
  useEvent("testing-notice", setNotice);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => {
      setNotice(null);
    }, NOTICE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  if (feedback) {
    return <TestingPrompt flow={feedback.flow} until={feedback.until} timeoutMs={feedback.timeoutMs} keys={prefs.testingKeys} />;
  }
  if (notice) return <TestingNotice text={notice.text} tone={notice.tone} />;
  if (!settings.enabled || !text) return null;
  return <StatusLine text={text} />;
}

/** How long a testing confirmation stays in the game. */
const NOTICE_MS = 5000;

/**
 * Keeps the window as tall as `el`'s content: the backend does not know the text size.
 * The backend sets its own height each time it shows the window, also while the same
 * content stays up, so the height is fitted again after every resize of the window too.
 */
function useFitHeight(el: RefObject<HTMLElement | null>) {
  const { textScale } = usePreferences();
  useEffect(() => {
    const box = el.current;
    if (!box || !isTauri()) return;
    const fit = () => {
      // The top padding of <main> above the box and room for its shadow below.
      void fitWindowHeight(box.offsetTop + box.offsetHeight + 8, textScale).catch(() => undefined);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [el, textScale]);
}

/** The ordinary status line; long text wraps and the window grows with it. */
function StatusLine({ text }: { text: string }) {
  const box = useRef<HTMLParagraphElement>(null);
  useFitHeight(box);
  return (
    <main aria-label="Overlay status" className="flex h-full items-start justify-center pt-2 text-text">
      <p ref={box} role="status" className={cn("max-w-full px-3 py-1.5 text-center font-medium", OVERLAY_PANEL, "border-accent")}>
        {text}
      </p>
    </main>
  );
}

/** What happened to an answer or a run's report, confirmed in the game. */
function TestingNotice({ text, tone }: EventMap["testing-notice"]) {
  const box = useRef<HTMLParagraphElement>(null);
  useFitHeight(box);
  return (
    <main aria-label="Testing result" className="flex h-full items-start justify-center pt-2 text-text">
      <p
        ref={box}
        role="status"
        className={
          tone === "success"
            ? cn("flex max-w-full items-center gap-2 px-3 py-1.5 font-medium", OVERLAY_PANEL, "border-success")
            : cn("flex max-w-full items-center gap-2 px-3 py-1.5 font-medium", OVERLAY_PANEL, "border-danger")
        }
      >
        <Icon icon={tone === "success" ? CircleCheck : CircleAlert} size="sm" className={tone === "success" ? "text-success" : "text-danger"} />
        {text}
      </p>
    </main>
  );
}

/** The question after a completed flow, with a bar that runs out when the backend stops waiting for an answer. */
function TestingPrompt({ flow, until, timeoutMs, keys }: { flow: FlowKind; until: number; timeoutMs: number; keys: TestingKeys }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 100);
    return () => {
      window.clearInterval(timer);
    };
  }, [until]);
  const left = Math.max(0, until - now);
  const box = useRef<HTMLDivElement>(null);
  // Follows the content, so a larger text size or a long key name never cuts the prompt off.
  useFitHeight(box);
  return (
    <main aria-label="Testing feedback" className="flex h-full items-start justify-center pt-2 text-text">
      <div
        ref={box}
        role="status"
        className={cn("flex max-w-full flex-col items-center gap-1.5 px-4 py-2 text-center", OVERLAY_PANEL, "border-accent")}
      >
        <p className="font-semibold">Did HexDesk read the {FLOW_LABEL[flow]} correctly?</p>
        <p className="text-xs text-muted">
          <kbd className="font-semibold text-text">{keyLabel(keys.correct)}</kbd> correct · discard &nbsp;{" "}
          <kbd className="font-semibold text-text">{keyLabel(keys.wrong)}</kbd> wrong · keep for report
        </p>
        <ProgressBar
          className="w-full justify-center"
          value={left}
          max={timeoutMs}
          name="Time left to answer"
          label={`${String(Math.ceil(left / 1000))} s`}
        />
      </div>
    </main>
  );
}
