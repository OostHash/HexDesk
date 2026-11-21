import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ExternalLink, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { openExternal } from "../../api/links";
import { saveSettings, setOcrModels, settingsKeys, useSaveSettings, useSettings, type SettingsFile } from "../../api/settings";
import { ocrModelsFrom } from "../../domain/settings";
import { FEEDBACK_FREQUENCIES, feedbackFrequencyFrom, LOG_RETENTION_DAYS, logRetentionDaysFrom } from "../../domain/testing";
import { HexDeskMark } from "../../patterns/HexDeskMark";
import { Button } from "../../primitives/actions";
import { Icon } from "../../primitives/display";
import { FormField, RadioGroup, Select, Slider, Switch } from "../../primitives/forms";
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

const DISCORD_URL = "https://discord.gg/GTCrhPMPQY";
const LAST_STEP = 3;
const percent = (scale: number) => `${String(Math.round(scale * 100))}%`;

/** Full-page first-run setup for appearance, privacy and testing consent. */
export function WelcomeScreen() {
  const queryClient = useQueryClient();
  const { data: settings = {} } = useSettings();
  const save = useSaveSettings();
  const prefs = usePreferences();
  const choices = availableChoices();
  const [step, setStep] = useState(0);
  const [ocrPending, setOcrPending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const testingEnabled = settings.testingEnabled === true;
  const frequency = feedbackFrequencyFrom(settings.feedbackFrequency);

  const chooseOcr = async (enabled: boolean) => {
    setOcrPending(true);
    setError(null);
    try {
      await setOcrModels(enabled);
      queryClient.setQueryData<SettingsFile>(settingsKeys.all, (current = {}) => ({ ...current, ocrModels: enabled }));
    } catch (cause) {
      setError(`Could not change the small-text reader: ${String(cause)}`);
    } finally {
      setOcrPending(false);
    }
  };

  const finish = async () => {
    setFinishing(true);
    setError(null);
    try {
      await saveSettings({ onboardingCompleted: true });
      queryClient.setQueryData<SettingsFile>(settingsKeys.all, (current = {}) => ({ ...current, onboardingCompleted: true }));
    } catch (cause) {
      setError(`Could not finish setup: ${String(cause)}`);
      setFinishing(false);
    }
  };

  return (
    <main aria-labelledby="welcome-title" className="flex min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-8 sm:px-10">
        <header className="mb-8 flex items-center gap-4">
          <HexDeskMark className="size-12" />
          <div>
            <p className="text-sm text-muted">Welcome to</p>
            <h1 id="welcome-title" className="text-2xl font-semibold text-text">
              HexDesk
            </h1>
          </div>
          <ol aria-label="Setup progress" className="ms-auto flex gap-2">
            {Array.from({ length: LAST_STEP + 1 }, (_, index) => (
              <li key={index}>
                <span className={index === step ? "block size-2.5 rounded-full bg-accent" : "block size-2.5 rounded-full bg-border-strong"}>
                  <span className="sr-only">{index === step ? `Step ${String(index + 1)} of 4, current` : `Step ${String(index + 1)} of 4`}</span>
                </span>
              </li>
            ))}
          </ol>
        </header>

        <section className="flex flex-1 flex-col rounded-xl border border-border bg-surface p-6 shadow-2 sm:p-8">
          {step === 0 && (
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-xl font-semibold">Make HexDesk comfortable</h2>
                <p className="mt-1 text-sm text-muted">These choices can be changed later in Settings → General.</p>
              </div>
              {choices.themes.length > 1 && (
                <RadioGroup
                  legend="Theme"
                  value={prefs.theme}
                  options={choices.themes.map((value) => ({ value, label: THEME_LABEL[value] }))}
                  appearance="segmented"
                  onValueChange={(theme) => {
                    setPreferences({ theme });
                  }}
                />
              )}
              <RadioGroup
                legend="Density"
                value={prefs.density}
                options={DENSITY_CHOICES.map((value) => ({ value, label: DENSITY_LABEL[value] }))}
                appearance="segmented"
                onValueChange={(density) => {
                  setPreferences({ density });
                }}
              />
              <FormField label="Text size">
                <Slider
                  className="max-w-md"
                  value={prefs.textScale}
                  min={TEXT_SCALE_RANGE.min}
                  max={TEXT_SCALE_RANGE.max}
                  step={TEXT_SCALE_RANGE.step}
                  formatValue={percent}
                  onValueChange={(textScale) => {
                    setPreferences({ textScale: clampTextScale(textScale) });
                  }}
                />
              </FormField>
              <div className="flex max-w-2xl items-start justify-between gap-6 rounded-lg border border-border bg-surface-raised p-4">
                <span>
                  <span className="block text-sm font-medium">Read small text more accurately</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Downloads about 12 MB of OCR models. They help with relic counts and refinement tags.
                  </span>
                </span>
                <Switch
                  checked={ocrModelsFrom(settings)}
                  disabled={ocrPending}
                  aria-label="Read small text more accurately"
                  onCheckedChange={(enabled) => {
                    void chooseOcr(enabled);
                  }}
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-xl font-semibold">Your data stays under your control</h2>
                <p className="mt-1 text-sm text-muted">HexDesk does not automatically upload logs, captures or test reports.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <InfoCard title="Diagnostic logs">App activity written to HexDesk&apos;s local app-data folder. Logs are separate from test samples.</InfoCard>
                <InfoCard title="Testing captures">The screen areas OCR reads, its OCR result and the matching game-and-overlay image. Pending files stay in local app data only until you answer.</InfoCard>
                <InfoCard title="Test reports">Saved as a zip in Downloads after a run. You decide whether to share it.</InfoCard>
              </div>
              <FormField
                label="Keep diagnostic logs for"
                description="HexDesk removes older daily log files when it starts and when a new daily log is opened."
              >
                <Select
                  value={logRetentionDaysFrom(settings.logRetentionDays)}
                  onChange={(event) => {
                    save.mutate({ logRetentionDays: Number(event.target.value) });
                  }}
                >
                  {LOG_RETENTION_DAYS.map((days) => (
                    <option key={days} value={days}>
                      {days === 1 ? "1 day" : `${String(days)} days`}
                    </option>
                  ))}
                </Select>
              </FormField>
              <p className="text-sm text-muted">
                The activity console can remove diagnostic logs, saved captures and pending test data. Factory reset removes all local HexDesk data.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-xl font-semibold">Help test HexDesk</h2>
                <p className="mt-1 text-sm text-muted">
                  This is optional and off by default. When enabled, HexDesk occasionally asks whether a completed screen flow was read correctly.
                </p>
              </div>
              <div className="flex max-w-2xl items-start justify-between gap-6 rounded-lg border border-border bg-surface-raised p-4">
                <span>
                  <span className="block text-sm font-medium">Help test HexDesk</span>
                  <span className="mt-0.5 block text-xs text-muted">Page Up marks a flow correct and discards it. Page Down keeps only that flow for a test report.</span>
                </span>
                <Switch
                  checked={testingEnabled}
                  aria-label="Help test HexDesk"
                  onCheckedChange={(enabled) => {
                    save.mutate({ testingEnabled: enabled });
                  }}
                />
              </div>
              {testingEnabled && (
                <RadioGroup
                  legend="Ask for feedback"
                  value={frequency}
                  options={FEEDBACK_FREQUENCIES}
                  onValueChange={(feedbackFrequency) => {
                    save.mutate({ feedbackFrequency });
                  }}
                />
              )}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 py-8 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Icon icon={ShieldCheck} size="lg" />
              </span>
              <div>
                <h2 className="text-xl font-semibold">You are ready</h2>
                <p className="mx-auto mt-1 max-w-xl text-sm text-muted">
                  You can revisit this setup and change testing, retention or appearance at any time in Settings → General.
                </p>
              </div>
              <Button variant="ghost" trailingIcon={ExternalLink} onClick={() => void openExternal(DISCORD_URL)}>
                Join the HexDesk Discord
              </Button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-5 text-sm text-danger">
              {error}
            </p>
          )}
          <footer className="mt-auto flex items-center justify-between gap-4 border-t border-border pt-6">
            <Button
              variant="ghost"
              leadingIcon={ArrowLeft}
              disabled={step === 0 || finishing}
              onClick={() => {
                setStep((current) => Math.max(0, current - 1));
              }}
            >
              Back
            </Button>
            {step < LAST_STEP ? (
              <Button
                variant="primary"
                trailingIcon={ArrowRight}
                disabled={ocrPending}
                onClick={() => {
                  setStep((current) => Math.min(LAST_STEP, current + 1));
                }}
              >
                Continue
              </Button>
            ) : (
              <Button variant="primary" loading={finishing} onClick={() => void finish()}>
                Start using HexDesk
              </Button>
            )}
          </footer>
        </section>
      </div>
    </main>
  );
}

function InfoCard({ title, children }: { title: string; children: string }) {
  return (
    <section className="rounded-lg border border-border bg-surface-raised p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 text-xs text-muted">{children}</p>
    </section>
  );
}
