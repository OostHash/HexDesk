import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Palette } from "lucide-react";
import { simulateUpdate, usePendingUpdate } from "../../api/app";
import { Button } from "../../primitives/actions";
import { ExportDiagnosticsButtons, useDiagnosticsExport } from "./ExportDiagnostics";
import { IconCheckGroup } from "./IconCheck";
import { ResultText, SettingRow, SettingsGroup } from "./parts";

/** One zip for a bug report; the path stays visible so it can be shown in Explorer. */
function ExportRow() {
  const exporting = useDiagnosticsExport();
  return (
    <SettingRow
      label="Diagnostics export"
      description="One zip with logs, system facts and settings to attach to a bug report. HexDesk tries to redact known sensitive values; review the zip before sharing it. What HexDesk does is visible live in Settings → Console."
      result={exporting.result && <ResultText tone={exporting.result.tone}>{exporting.result.text}</ResultText>}
    >
      <ExportDiagnosticsButtons state={exporting} />
    </SettingRow>
  );
}

/** A fake available release, so the red dot and the Updates group can be tried without a real one. */
function SimulateUpdateRow() {
  const queryClient = useQueryClient();
  const pending = usePendingUpdate();
  return (
    <SettingRow
      label="Simulate update"
      description="Pretend version 9.9.9 is available: Settings gets its red dot and General offers to install. Installing still runs the real check, so nothing is installed."
    >
      {pending ? (
        <Button
          size="sm"
          onClick={() => {
            simulateUpdate(queryClient, null);
          }}
        >
          Clear
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => {
            simulateUpdate(queryClient, "9.9.9");
          }}
        >
          Simulate
        </Button>
      )}
    </SettingRow>
  );
}

/** Settings → Debugging, in development builds only: the diagnostics export, update simulation, the icon check and the developer pages. */
export function DebuggingTab() {
  return (
    <>
      <SettingsGroup title="Bug reports">
        <ExportRow />
      </SettingsGroup>

      <SettingsGroup title="Updates">
        <SimulateUpdateRow />
      </SettingsGroup>

      <IconCheckGroup />

      <SettingsGroup title="Developer pages">
        <SettingRow label="Kitchen sink" description="Inspect the app's reusable interface components and interaction states.">
          <Button
            size="sm"
            leadingIcon={FlaskConical}
            onClick={() => {
              window.location.assign("?view=kitchen-sink");
            }}
          >
            Open
          </Button>
        </SettingRow>
        <SettingRow label="Tokens" description="Inspect the generated theme colours, spacing and density tokens.">
          <Button
            size="sm"
            leadingIcon={Palette}
            onClick={() => {
              window.location.assign("?view=tokens");
            }}
          >
            Open
          </Button>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}
