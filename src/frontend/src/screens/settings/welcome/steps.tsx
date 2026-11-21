import { ExternalLink, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { openExternal } from "../../../api/links";
import { Button } from "../../../primitives/actions";
import { Icon } from "../../../primitives/display";
import { DensityRow, LogRetentionRow, OcrModelsRow, TestingRows, TextSizeRow, ThemeRow } from "../controls";
import { SettingsCard } from "../parts";

const DISCORD_URL = "https://discord.gg/GTCrhPMPQY";

/** One page of the welcome screen, in order. */
export const STEPS = [ComfortStep, PrivacyStep, TestingStep, ReadyStep] as const;

function StepHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </div>
  );
}

function ComfortStep() {
  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="Make HexDesk comfortable">These choices can be changed later in Settings → General.</StepHeading>
      <SettingsCard>
        <ThemeRow />
        <DensityRow />
        <TextSizeRow />
        <OcrModelsRow />
      </SettingsCard>
    </div>
  );
}

function PrivacyStep() {
  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="Your data stays under your control">HexDesk does not automatically upload logs, captures or test reports.</StepHeading>
      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard title="Diagnostic logs">
          App activity written to HexDesk&apos;s local app-data folder. Logs are separate from test samples.
        </InfoCard>
        <InfoCard title="Testing captures">
          The screen areas OCR reads, its OCR result and the matching game-and-overlay image. Pending files stay in local app data only until you
          answer.
        </InfoCard>
        <InfoCard title="Test reports">Saved as a zip in Downloads after a run. You decide whether to share it.</InfoCard>
      </div>
      <SettingsCard>
        <LogRetentionRow />
      </SettingsCard>
      <p className="text-sm text-muted">
        The activity console can remove diagnostic logs, saved captures and test data that has not been saved as a report yet. Factory reset removes
        all local HexDesk data.
      </p>
    </div>
  );
}

function TestingStep() {
  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="Help test HexDesk">
        This is optional and off by default. When enabled, HexDesk occasionally asks whether a completed screen flow was read correctly.
      </StepHeading>
      <SettingsCard>
        <TestingRows />
      </SettingsCard>
    </div>
  );
}

function ReadyStep() {
  return (
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
  );
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface-raised p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 text-xs text-muted">{children}</p>
    </section>
  );
}
