import { useAppVersion, useCheckForUpdate, useInstallUpdate, usePendingUpdate } from "../../api/app";
import { useClock } from "../../api/statistics";
import { Button } from "../../primitives/actions";
import { clockFormatFrom, type ClockFormat } from "../../domain/statistics";
import { Badge } from "../../primitives/display";
import { RadioGroup } from "../../primitives/forms";
import { availableChoices, CONTRAST_LABEL, setPreferences, usePreferences } from "../../state/preferences";
import { DensityRow, LogRetentionRow, OcrModelsRow, TestingRows, TextSizeRow, ThemeRow } from "./controls";
import { NotificationsGroup } from "./NotificationsGroup";
import { ResultText, SettingRow, SettingsGroup, SwitchRow, useSettingsFile } from "./parts";

const CLOCK_OPTIONS: ReadonlyArray<{ value: ClockFormat; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "12h", label: "12h" },
  { value: "24h", label: "24h" },
];
/** Local diagnostics, optional testing and a way back into onboarding. */
function PrivacyTestingGroup() {
  const { set } = useSettingsFile();
  return (
    <SettingsGroup title="Privacy and testing">
      <LogRetentionRow />
      <TestingRows />
      <SettingRow label="Welcome and privacy" description="Review appearance, local data and testing choices from the beginning.">
        <Button
          size="sm"
          onClick={() => {
            set({ onboardingCompleted: false });
          }}
        >
          Show welcome screen again
        </Button>
      </SettingRow>
    </SettingsGroup>
  );
}

function OcrGroup() {
  return (
    <SettingsGroup title="OCR">
      <OcrModelsRow />
    </SettingsGroup>
  );
}

/** Theme, contrast, colours, density, text size and clock. */
function AppearanceGroup() {
  const { settings, set } = useSettingsFile();
  const prefs = usePreferences();
  const { locale } = useClock();
  const clock = clockFormatFrom(settings.clockFormat);
  // Only choices with a token set behind them.
  const choices = availableChoices();
  return (
    <SettingsGroup title="Appearance">
      <ThemeRow />
      {choices.contrasts.length > 1 && (
        <SettingRow group={false} label="Contrast">
          <RadioGroup
            legend="Contrast"
            hideLegend
            appearance="segmented"
            value={prefs.contrast}
            options={choices.contrasts.map((value) => ({ value, label: CONTRAST_LABEL[value] }))}
            onValueChange={(contrast) => {
              setPreferences({ contrast });
            }}
          />
        </SettingRow>
      )}
      <SwitchRow
        label="Colour-blind palette"
        description="Blue and orange instead of green and red for gains and losses, owned and vaulted, success and errors."
        checked={prefs.cvd}
        onCheckedChange={(on) => {
          setPreferences({ cvd: on });
        }}
      />
      <DensityRow />
      <TextSizeRow />
      <SettingRow
        group={false}
        label="Clock format"
        description={`How times are shown throughout the app.${clock === "auto" ? ` System locale: ${locale}.` : ""}`}
      >
        <RadioGroup
          legend="Clock format"
          hideLegend
          appearance="segmented"
          value={clock}
          options={CLOCK_OPTIONS}
          onValueChange={(next) => {
            set({ clockFormat: next });
          }}
        />
      </SettingRow>
    </SettingsGroup>
  );
}

/** Check for a new release on demand, and install it from here when there is one. */
function UpdatesGroup() {
  const version = useAppVersion();
  const check = useCheckForUpdate();
  const install = useInstallUpdate();
  // The check at start (or an earlier one here) may already have found an update.
  const pending = usePendingUpdate();
  const available = check.data ?? pending;
  const result = check.isError ? (
    <ResultText tone="danger">Update check failed: {String(check.error)}</ResultText>
  ) : install.isError ? (
    <ResultText tone="danger">Update failed: {String(install.error)}</ResultText>
  ) : available ? (
    <ResultText tone="success">Version {available} is available.</ResultText>
  ) : check.isSuccess ? (
    <ResultText tone="success">HexDesk is up to date.</ResultText>
  ) : null;
  return (
    <SettingsGroup title="Updates">
      <SettingRow
        label="Check for updates"
        description={`You have version ${version ?? "unknown"}. HexDesk also checks when it starts.`}
        result={result}
      >
        {available ? (
          <Button
            size="sm"
            variant="primary"
            loading={install.isPending}
            onClick={() => {
              install.mutate();
            }}
          >
            {install.isPending ? "Installing…" : "Install and restart"}
          </Button>
        ) : (
          <Button
            size="sm"
            loading={check.isPending}
            onClick={() => {
              check.mutate();
            }}
          >
            {check.isPending ? "Checking…" : "Check now"}
          </Button>
        )}
      </SettingRow>
    </SettingsGroup>
  );
}

export function GeneralTab() {
  const { settings, set } = useSettingsFile();
  return (
    <>
      <UpdatesGroup />
      <PrivacyTestingGroup />
      <OcrGroup />
      <SettingsGroup
        title="Memory scanner"
        badge={
          <Badge tone="warning" variant="outline">
            EULA grey area
          </Badge>
        }
      >
        <SwitchRow
          label="Enable memory scanner"
          description={
            <>
              Required for live inventory, quantity tracking and mod ranks. Reads Warframe&apos;s process memory with <code>ReadProcessMemory</code>.
              DE has historically tolerated read-only tools, but has not given explicit permission. Enable at your own risk.
            </>
          }
          checked={settings.memoryScannerEnabled === true}
          onCheckedChange={(on) => {
            set({ memoryScannerEnabled: on });
          }}
        />
      </SettingsGroup>

      <SettingsGroup title="Windows">
        <SwitchRow
          label="Modular window in its own window"
          description="Detach the modular window from the main window into a window you can place anywhere."
          checked={settings.modularPopout === true}
          onCheckedChange={(on) => {
            set({ modularPopout: on });
          }}
        />
        <SwitchRow
          label="Changelog in its own window"
          description="Detach the changelog from the bottom of the main window into a window you can place anywhere."
          checked={settings.changelogPopout === true}
          onCheckedChange={(on) => {
            set({ changelogPopout: on });
          }}
        />
      </SettingsGroup>

      <NotificationsGroup />

      <AppearanceGroup />
    </>
  );
}
