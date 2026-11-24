import { useState } from "react";
import { overlayPrefsFrom } from "../../api/overlays";
import { useOcrModels } from "../../api/settings";
import { keyFromCode, keyLabel, NO_KEY, testingKeysSet, type OverlayKey } from "../../domain/overlayKey";
import { ocrModelsFrom } from "../../domain/settings";
import { FEEDBACK_FREQUENCIES, feedbackFrequencyFrom, LOG_RETENTION_DAYS, logRetentionDaysFrom, retentionLabel } from "../../domain/testing";
import { Check } from "lucide-react";
import { cn } from "../../primitives/cn";
import { Badge, Icon } from "../../primitives/display";
import { FormField, KeyInput, RadioGroup, Select, Slider } from "../../primitives/forms";
import {
  ACCENT_CHOICES,
  ACCENT_LABEL,
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

/**
 * Accent colour as round swatches. They are native radio buttons, so arrow
 * keys move between them; the chosen one has a check and a ring, not only
 * its colour. Windows High Contrast would drop their fill, so they keep it
 * (forced-color-adjust). The app's high contrast keeps its own accent.
 */
export function AccentRow() {
  const prefs = usePreferences();
  return (
    <SettingRow
      group={false}
      label="Accent colour"
      description="Buttons, selection and focus. Status and game colours stay as they are; high contrast keeps its own."
    >
      <fieldset className="flex items-center gap-2">
        <legend className="sr-only">Accent colour</legend>
        {ACCENT_CHOICES.map((accent) => {
          const checked = prefs.accent === accent;
          return (
            <label
              key={accent}
              title={ACCENT_LABEL[accent]}
              className={cn(
                "inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-on-accent forced-color-adjust-none",
                "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
                checked && "ring-2 ring-text ring-offset-2 ring-offset-surface",
              )}
              style={{ background: `var(--hex-swatch-${accent})` }}
            >
              <input
                type="radio"
                name="accent"
                value={accent}
                checked={checked}
                aria-label={ACCENT_LABEL[accent]}
                className="sr-only"
                onChange={() => {
                  setPreferences({ accent });
                }}
              />
              {checked && <Icon icon={Check} size="sm" />}
            </label>
          );
        })}
      </fieldset>
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

/** Marks the memory scanner as allowed by neither the EULA nor DE explicitly. */
export function MemoryScannerBadge() {
  return (
    <Badge tone="warning" variant="outline">
      EULA grey area
    </Badge>
  );
}

/** The memory scanner opt-in; off until the player turns it on. */
export function MemoryScannerRow() {
  const { settings, set } = useSettingsFile();
  return (
    <SwitchRow
      label="Enable memory scanner"
      description={
        <>
          Required for live inventory, quantity tracking and mod ranks. Reads Warframe&apos;s process memory with <code>ReadProcessMemory</code>. DE
          has historically tolerated read-only tools, but has not given explicit permission. Enable at your own risk.
        </>
      }
      checked={settings.memoryScannerEnabled === true}
      onCheckedChange={(on) => {
        set({ memoryScannerEnabled: on });
      }}
    />
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
  const keys = overlayPrefsFrom(settings).testingKeys;
  const keysSet = testingKeysSet(keys);
  const answer = keysSet
    ? `${keyLabel(keys.correct)} forgets the screen; ${keyLabel(keys.wrong)} keeps it for a local report.`
    : "One key forgets the screen; another keeps it for a local report.";
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <SwitchRow
          label="Help test HexDesk"
          description={`After a relic reward, a refinement or a riven, HexDesk asks whether it read the screen correctly. ${answer} Nothing is uploaded automatically.`}
          checked={enabled}
          onCheckedChange={(testingEnabled) => {
            set({ testingEnabled });
          }}
        />
        {enabled && !keysSet && (
          <p role="status" className="text-xs text-warning">
            Testing needs both a correct and a wrong key. Without them, HexDesk does not ask.
          </p>
        )}
      </div>
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
      {enabled && <TestingKeyRows />}
    </>
  );
}

/** Why a pressed key cannot be used, or null when it can. */
function unusableKey(code: string, takenBy: Array<{ key: OverlayKey; name: string }>): string | null {
  if (!keyFromCode(code)) return "That key cannot be used. Choose a letter, digit, function key, arrow, numpad or navigation key.";
  const taken = takenBy.find((other) => other.key === code);
  return taken ? `${keyLabel(code)} is already the ${taken.name}.` : null;
}

/** The two keys that answer the testing prompt; they can never be the same key. */
function TestingKeyRows() {
  const { settings, set } = useSettingsFile();
  const prefs = overlayPrefsFrom(settings);
  const { correct, wrong } = prefs.testingKeys;
  const [errors, setErrors] = useState<Partial<Record<"correct" | "wrong", string>>>({});
  const sharesOverlayKey = correct === prefs.overlayKey || wrong === prefs.overlayKey;
  const row = (which: "correct" | "wrong", label: string, description: string) => {
    const other = which === "correct" ? { key: wrong, name: "wrong key" } : { key: correct, name: "correct key" };
    return (
      <FormField layout="row" label={label} description={description} error={errors[which]}>
        <KeyInput
          className="w-48"
          value={keyLabel(prefs.testingKeys[which])}
          hasKey={prefs.testingKeys[which] !== NO_KEY}
          clearLabel={`Remove ${label.toLowerCase()}`}
          onClear={() => {
            setErrors((current) => ({ ...current, [which]: undefined }));
            set({ testingCorrectKey: correct, testingWrongKey: wrong, [which === "correct" ? "testingCorrectKey" : "testingWrongKey"]: NO_KEY });
          }}
          invalid={errors[which] !== undefined}
          onKey={(code) => {
            const error = unusableKey(code, [other]);
            setErrors((current) => ({ ...current, [which]: error ?? undefined }));
            // Both keys are saved, so a missing partner never falls back to a clashing default.
            if (!error)
              set({ testingCorrectKey: correct, testingWrongKey: wrong, [which === "correct" ? "testingCorrectKey" : "testingWrongKey"]: code });
          }}
        />
      </FormField>
    );
  };
  return (
    <>
      {row("correct", "Correct key", "Marks the screen as read correctly; HexDesk forgets it.")}
      {row("wrong", "Wrong key", "Marks the screen as read wrong; HexDesk keeps it for your report.")}
      <p className="text-xs text-muted">
        {sharesOverlayKey
          ? "One of these is also the overlay key. While the question is shown, it answers instead of opening or hiding an overlay."
          : "The game does not receive these keys while the question is shown, and receives them as usual otherwise."}
      </p>
    </>
  );
}

/** The key that hides overlays on screen or opens the one for the current screen. */
export function OverlayKeyRow() {
  const { settings, set } = useSettingsFile();
  const prefs = overlayPrefsFrom(settings);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormField
      layout="row"
      label="Overlay key"
      description="Click the field and press a key, or Backspace for none. It hides the overlays on screen; with none on screen, it opens the overlay for the screen you are on. The game still receives the key."
      error={error}
    >
      <KeyInput
        className="w-48"
        value={keyLabel(prefs.overlayKey)}
        hasKey={prefs.overlayKey !== NO_KEY}
        clearLabel="Remove overlay key"
        invalid={error !== null}
        disabled={!prefs.overlaysEnabled}
        onKey={(code) => {
          const problem = unusableKey(code, []);
          setError(problem);
          if (!problem) set({ overlayKey: code });
        }}
        onClear={() => {
          setError(null);
          set({ overlayKey: NO_KEY });
        }}
      />
    </FormField>
  );
}

export function ManualModeRow() {
  const { settings, set } = useSettingsFile();
  const prefs = overlayPrefsFrom(settings);
  const keyless = prefs.overlayManual && prefs.overlayKey === NO_KEY;
  return (
    <div className="flex flex-col gap-1.5">
      <SwitchRow
        label="Manual mode"
        description="Open overlays only with the overlay key. The game's log still closes them, and the screen is read only when you press the key."
        checked={prefs.overlayManual}
        disabled={!prefs.overlaysEnabled}
        onCheckedChange={(on) => {
          // The main window tells the backend (RelicOverlayController).
          set({ overlayManual: on });
        }}
      />
      {keyless && (
        <p role="status" className="text-xs text-warning">
          Manual mode needs an overlay key. Without one, no overlay opens.
        </p>
      )}
    </div>
  );
}
