import { useAppVersion, useCheckForUpdate, useInstallUpdate, usePendingUpdate } from "../../api/app";
import { useClock } from "../../api/statistics";
import { Button } from "../../primitives/actions";
import { clockFormatFrom, type ClockFormat } from "../../domain/statistics";
import { RadioGroup } from "../../primitives/forms";
import { availableChoices, CONTRAST_LABEL, setPreferences, usePreferences } from "../../state/preferences";
import { AccentRow, DensityRow, MemoryScannerBadge, MemoryScannerRow, OcrModelsRow, TestingRows, TextSizeRow, ThemeRow } from "./controls";
import { NotificationsGroup } from "./NotificationsGroup";
import { ResultText, SettingRow, SettingsGroup, SwitchRow, useSettingsFile } from "./parts";

const CLOCK_OPTIONS: ReadonlyArray<{ value: ClockFormat; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "12h", label: "12h" },
  { value: "24h", label: "24h" },
];
function MemoryScannerGroup() {
  return (
    <SettingsGroup title="Memory scanner" badge={<MemoryScannerBadge />}>
      <MemoryScannerRow />
    </SettingsGroup>
  );
}

function ScreenReadingGroup() {
  return (
    <SettingsGroup title="Screen reading">
      <OcrModelsRow />
    </SettingsGroup>
  );
}

function TestingGroup() {
  return (
    <SettingsGroup title="Testing">
      <TestingRows />
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
      <AccentRow />
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

/** The installed version, a check for a new release that installs it from here, and a way back into the welcome screen. */
function HexDeskGroup() {
  const { set } = useSettingsFile();
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
    <SettingsGroup title="HexDesk">
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
      <SettingRow
        label="Welcome screen"
        description="Go through the welcome screen again: appearance, memory scanner, overlays, testing and the community."
      >
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

/** Most-changed first: how HexDesk looks and behaves, then what it reads from the game, then HexDesk itself. */
export function GeneralTab() {
  const { settings, set } = useSettingsFile();
  return (
    <>
      <AppearanceGroup />

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

      <MemoryScannerGroup />
      <ScreenReadingGroup />
      <TestingGroup />

      <HexDeskGroup />
    </>
  );
}
