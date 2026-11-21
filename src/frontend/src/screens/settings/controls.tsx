import { useState } from "react";
import { useOcrModels } from "../../api/settings";
import { ocrModelsFrom } from "../../domain/settings";
import { FEEDBACK_FREQUENCIES, feedbackFrequencyFrom, LOG_RETENTION_DAYS, logRetentionDaysFrom, retentionLabel } from "../../domain/testing";
import { FormField, RadioGroup, Select, Slider } from "../../primitives/forms";
import {
  availableChoices,
  clampTextScale,
  DENSITY_CHOICES,
  DENSITY_LABEL,
  setPreferences,
  TEXT_SCALE_RANGE,
  THEME_LABEL,
  usePreferences,
} from "../../state/preferences";
import { ResultText, SettingRow, SwitchRow, useSettingsFile } from "./parts";

/*
 * Setting rows shared by Settings → General and the welcome screen, so both
 * offer the same choices with the same words.
 */

const DENSITY_OPTIONS = DENSITY_CHOICES.map((value) => ({ value, label: DENSITY_LABEL[value] }));
const percent = (scale: number) => `${String(Math.round(scale * 100))}%`;

/** Theme choice; rendered only when more than one theme has a token set. */
export function ThemeRow() {
  const prefs = usePreferences();
  const themes = availableChoices().themes;
  if (themes.length < 2) return null;
  return (
    <SettingRow group={false} label="Theme">
      <RadioGroup
        legend="Theme"
        hideLegend
        appearance="segmented"
        value={prefs.theme}
        options={themes.map((value) => ({ value, label: THEME_LABEL[value] }))}
        onValueChange={(theme) => {
          setPreferences({ theme });
        }}
      />
    </SettingRow>
  );
}

export function DensityRow() {
  const prefs = usePreferences();
  return (
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
  );
}

/**
 * Text size applies when the slider is released: it zooms the whole window, which would move the slider under
 * the pointer while dragging.
 */
export function TextSizeRow() {
  const prefs = usePreferences();
  const [dragging, setDragging] = useState<number | null>(null);
  return (
    <FormField layout="row" label="Text size">
      <Slider
        className="w-56"
        value={dragging ?? prefs.textScale}
        min={TEXT_SCALE_RANGE.min}
        max={TEXT_SCALE_RANGE.max}
        step={TEXT_SCALE_RANGE.step}
        formatValue={percent}
        onValueChange={setDragging}
        onValueCommit={(value) => {
          setDragging(null);
          setPreferences({ textScale: clampTextScale(value) });
        }}
      />
    </FormField>
  );
}

/**
 * HexDesk reads the screen with Windows OCR. The ocrs models, downloaded once, read what Windows OCR misses; the
 * player decides whether they may be downloaded.
 */
export function OcrModelsRow({
  description = "Downloads about 12 MB of OCR models once. They read what Windows OCR misses, such as relic counts and refinement tags, which can make a read slightly slower.",
}: {
  description?: string;
}) {
  const { settings } = useSettingsFile();
  const ocr = useOcrModels();
  const pending = ocr.isPending ? ocr.variables : null;
  return (
    <div className="flex flex-col gap-1.5">
      <SwitchRow
        label="Read small text more accurately"
        description={description}
        checked={pending ?? ocrModelsFrom(settings)}
        disabled={ocr.isPending}
        onCheckedChange={(enabled) => {
          ocr.mutate(enabled);
        }}
      />
      {pending ? (
        <p role="status" className="text-xs text-muted">
          Downloading and preparing the OCR models…
        </p>
      ) : ocr.isError ? (
        <ResultText tone="danger">Could not change the OCR models: {String(ocr.error)}</ResultText>
      ) : ocr.isSuccess && ocr.variables ? (
        <ResultText tone="success">The OCR models are downloaded and in use.</ResultText>
      ) : null}
    </div>
  );
}

export function LogRetentionRow() {
  const { settings, set } = useSettingsFile();
  return (
    <FormField
      layout="row"
      label="Keep diagnostic logs for"
      description="Logs stay on this computer and are never uploaded automatically. Older daily files are removed when HexDesk starts and when a new day's log begins."
    >
      <Select
        value={logRetentionDaysFrom(settings.logRetentionDays)}
        onChange={(event) => {
          set({ logRetentionDays: Number(event.target.value) });
        }}
      >
        {LOG_RETENTION_DAYS.map((days) => (
          <option key={days} value={days}>
            {retentionLabel(days)}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

/** The testing opt-in and, while it is on, how often HexDesk asks. */
export function TestingRows() {
  const { settings, set } = useSettingsFile();
  const enabled = settings.testingEnabled === true;
  return (
    <>
      <SwitchRow
        label="Help test HexDesk"
        description="After a completed screen flow, HexDesk asks whether it was read correctly. Page Up discards the flow; Page Down keeps it for a local report. Nothing is uploaded automatically."
        checked={enabled}
        onCheckedChange={(testingEnabled) => {
          set({ testingEnabled });
        }}
      />
      {enabled && (
        <FormField layout="row" label="Ask for feedback">
          <Select
            value={feedbackFrequencyFrom(settings.feedbackFrequency)}
            onChange={(event) => {
              set({ feedbackFrequency: feedbackFrequencyFrom(event.target.value) });
            }}
          >
            {FEEDBACK_FREQUENCIES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </Select>
        </FormField>
      )}
    </>
  );
}
