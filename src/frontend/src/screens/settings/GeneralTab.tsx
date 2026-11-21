import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAppVersion, useCheckForUpdate, useInstallUpdate, usePendingUpdate } from "../../api/app";
import { setOcrModels, settingsKeys, type SettingsFile } from "../../api/settings";
import { useClock } from "../../api/statistics";
import { Button } from "../../primitives/actions";
import { ocrModelsFrom } from "../../domain/settings";
import { FEEDBACK_FREQUENCIES, feedbackFrequencyFrom, LOG_RETENTION_DAYS, logRetentionDaysFrom } from "../../domain/testing";
import { clockFormatFrom, type ClockFormat } from "../../domain/statistics";
import { Badge } from "../../primitives/display";
import { FormField, RadioGroup, Select, Slider } from "../../primitives/forms";
import {
  availableChoices,
  clampTextScale,
  CONTRAST_LABEL,
  DENSITY_CHOICES,
  DENSITY_LABEL,
  setPreferences,
  TEXT_SCALE_RANGE,
  THEME_LABEL,
  usePreferences,
} from "../../state/preferences";
import { NotificationsGroup } from "./NotificationsGroup";
import { ResultText, SettingRow, SettingsGroup, SwitchRow, useSettingsFile } from "./parts";

const CLOCK_OPTIONS: ReadonlyArray<{ value: ClockFormat; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "12h", label: "12h" },
  { value: "24h", label: "24h" },
];
const DENSITY_OPTIONS = DENSITY_CHOICES.map((value) => ({ value, label: DENSITY_LABEL[value] }));

const percent = (scale: number) => `${String(Math.round(scale * 100))}%`;

/** Local diagnostics, optional testing and a way back into onboarding. */
function PrivacyTestingGroup() {
  const { settings, set } = useSettingsFile();
  const testingEnabled = settings.testingEnabled === true;
  return (
    <SettingsGroup title="Privacy and testing">
      <FormField
        layout="row"
        label="Keep diagnostic logs for"
        description="Logs stay on this computer and are never uploaded automatically. Older daily files are removed automatically."
      >
        <Select
          value={logRetentionDaysFrom(settings.logRetentionDays)}
          onChange={(event) => {
            set({ logRetentionDays: Number(event.target.value) });
          }}
        >
          {LOG_RETENTION_DAYS.map((days) => (
            <option key={days} value={days}>
              {days === 1 ? "1 day" : `${String(days)} days`}
            </option>
          ))}
        </Select>
      </FormField>
      <SwitchRow
        label="Help test HexDesk"
        description="Ask whether completed screen flows were read correctly. Page Up discards a correct flow; Page Down keeps a wrong flow for a local report. Nothing is uploaded automatically."
        checked={testingEnabled}
        onCheckedChange={(testing) => {
          set({ testingEnabled: testing });
        }}
      />
      {testingEnabled && (
        <SettingRow group={false} label="Ask for feedback">
          <RadioGroup
            legend="Ask for feedback"
            hideLegend
            value={feedbackFrequencyFrom(settings.feedbackFrequency)}
            options={FEEDBACK_FREQUENCIES}
            onValueChange={(feedbackFrequency) => {
              set({ feedbackFrequency });
            }}
          />
        </SettingRow>
      )}
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

/**
 * HexDesk reads the screen with Windows OCR. The ocrs models, downloaded once, read what Windows OCR misses; the
 * player decides whether they may be downloaded.
 */
function OcrGroup() {
  const { settings } = useSettingsFile();
  const queryClient = useQueryClient();
  const allowed = ocrModelsFrom(settings);
  const [pending, setPending] = useState<boolean | null>(null);
  const [result, setResult] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const choose = async (enabled: boolean) => {
    setPending(enabled);
    setResult(null);
    try {
      await setOcrModels(enabled);
      queryClient.setQueryData<SettingsFile>(settingsKeys.all, (current = {}) => ({ ...current, ocrModels: enabled }));
      if (enabled) setResult({ tone: "success", text: "The OCR models are downloaded and in use." });
    } catch (error) {
      setResult({ tone: "danger", text: `Could not download the OCR models: ${String(error)}` });
    } finally {
      setPending(null);
    }
  };

  return (
    <SettingsGroup title="OCR">
      <SwitchRow
        label="Read small text more accurately"
        description="Downloads about 12 MB of OCR models once. They read what Windows OCR misses, such as relic counts and refinement tags, which can make a read slightly slower."
        checked={pending ?? allowed}
        disabled={pending !== null}
        onCheckedChange={(enabled) => {
          void choose(enabled);
        }}
      />
      {pending ? (
        <p role="status" className="text-xs text-muted">
          Downloading and preparing the OCR models…
        </p>
      ) : result ? (
        <ResultText tone={result.tone}>{result.text}</ResultText>
      ) : null}
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
      {choices.themes.length > 1 && (
        <SettingRow group={false} label="Theme">
          <RadioGroup
            legend="Theme"
            hideLegend
            appearance="segmented"
            value={prefs.theme}
            options={choices.themes.map((value) => ({ value, label: THEME_LABEL[value] }))}
            onValueChange={(theme) => {
              setPreferences({ theme });
            }}
          />
        </SettingRow>
      )}
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
      <SettingRow group={false} label="Density" description="Height of buttons, fields and table rows. Text size stays as set.">
        <RadioGroup
          legend="Density"
          hideLegend
          appearance="segmented"
          value={prefs.density}
          options={DENSITY_OPTIONS}
          onValueChange={(density) => {
            setPreferences({ density });
          }}
        />
      </SettingRow>
      <FormField layout="row" label="Text size">
        <Slider
          className="w-56"
          value={prefs.textScale}
          min={TEXT_SCALE_RANGE.min}
          max={TEXT_SCALE_RANGE.max}
          step={TEXT_SCALE_RANGE.step}
          formatValue={percent}
          onValueChange={(value) => {
            setPreferences({ textScale: clampTextScale(value) });
          }}
        />
      </FormField>
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
