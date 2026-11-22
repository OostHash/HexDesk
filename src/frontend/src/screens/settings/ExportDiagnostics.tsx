import { FolderOpen } from "lucide-react";
import { useState } from "react";
import type { DiagnosticsParts } from "../../api/commands";
import { exportDiagnostics, showDiagnosticsExport } from "../../api/debug";
import { Button } from "../../primitives/actions";
import { Checkbox } from "../../primitives/forms";
import { Modal } from "../../primitives/overlay";

export type ExportResult = { tone: "success" | "danger"; text: string } | null;

const ALL_PARTS: DiagnosticsParts = { system: true, settings: true, activity: true, logs: true };

/** The parts a user can leave out, with what each one holds. */
const PART_CHOICES: ReadonlyArray<{ key: keyof DiagnosticsParts; label: string; description: string }> = [
  {
    key: "system",
    label: "System information",
    description: "HexDesk version, Windows version, screens, language, WebView2 and OCR languages.",
  },
  { key: "settings", label: "Settings", description: "Your HexDesk settings file." },
  { key: "activity", label: "Activity", description: "The entries shown in the activity console." },
  { key: "logs", label: "Log files", description: "The full logs HexDesk wrote." },
];

/** The diagnostics export: where the last zip went, and whether one is being written. */
export function useDiagnosticsExport() {
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult>(null);
  const run = (parts: DiagnosticsParts) =>
    new Promise<boolean>((resolve) => {
      setBusy(true);
      setResult(null);
      exportDiagnostics(parts)
        .then(
          (saved) => {
            setPath(saved);
            setResult({ tone: "success", text: `Saved to ${saved}` });
            resolve(true);
          },
          (error: unknown) => {
            setResult({ tone: "danger", text: `Export failed: ${String(error)}` });
            resolve(false);
          },
        )
        .finally(() => {
          setBusy(false);
        });
    });
  return { busy, path, result, run };
}

/** "Show in folder" (once a zip exists) and "Export", which first asks what to include. */
export function ExportDiagnosticsButtons({ state }: { state: ReturnType<typeof useDiagnosticsExport> }) {
  const { busy, path, run } = state;
  const [choosing, setChoosing] = useState(false);
  const [parts, setParts] = useState<DiagnosticsParts>(ALL_PARTS);
  const nothing = !Object.values(parts).some(Boolean);
  return (
    <>
      {path !== null && (
        <Button size="sm" leadingIcon={FolderOpen} onClick={() => void showDiagnosticsExport(path).catch(() => undefined)}>
          Show in folder
        </Button>
      )}
      <Button
        size="sm"
        loading={busy}
        onClick={() => {
          setChoosing(true);
        }}
      >
        {busy ? "Exporting…" : "Export…"}
      </Button>
      <Modal
        open={choosing}
        onClose={() => {
          setChoosing(false);
        }}
        title="Export diagnostics"
        description="Choose what goes into the zip. A short read-me is always included."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setChoosing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={nothing}
              onClick={() => {
                void run(parts).then((saved) => {
                  if (saved) setChoosing(false);
                });
              }}
            >
              Export
            </Button>
          </>
        }
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Include in the export</legend>
          {PART_CHOICES.map((choice) => (
            <Checkbox
              key={choice.key}
              checked={parts[choice.key]}
              onCheckedChange={(on) => {
                setParts((previous) => ({ ...previous, [choice.key]: on }));
              }}
              className="items-start"
            >
              <span className="flex flex-col">
                <span className="font-medium">{choice.label}</span>
                <span className="text-xs text-muted">{choice.description}</span>
              </span>
            </Checkbox>
          ))}
        </fieldset>
        <p className="mt-3 text-xs text-muted">
          HexDesk tries to redact known sensitive values, but automatic redaction may miss something. Review the zip before sharing it.
        </p>
        {state.result?.tone === "danger" && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {state.result.text}
          </p>
        )}
      </Modal>
    </>
  );
}
