import { useIsMutating } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useAppVersion } from "../../../api/app";
import { ocrModelsMutationKey, useSaveSettingsConfirmed } from "../../../api/settings";
import { HexDeskMark } from "../../../patterns/HexDeskMark";
import { Button } from "../../../primitives/actions";
import { SETUP_STEPS } from "./steps";

const LAST_STEP = SETUP_STEPS.length - 1;

/** Full-page first-run setup: a welcome page, then appearance, testing and the community. */
export function WelcomeScreen() {
  // null is the welcome page; a number is an index into SETUP_STEPS.
  const [step, setStep] = useState<number | null>(null);
  if (step === null) {
    return (
      <Hero
        onStart={() => {
          setStep(0);
        }}
      />
    );
  }
  return <Setup step={step} onStep={setStep} />;
}

function Hero({ onStart }: { onStart: () => void }) {
  const version = useAppVersion();
  return (
    <main aria-labelledby="welcome-title" className="flex min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="m-auto flex max-w-xl flex-col items-center gap-6 px-6 py-12 text-center">
        <HexDeskMark className="size-28 text-accent" />
        <div className="flex flex-col gap-2">
          <h1 id="welcome-title" className="text-4xl font-semibold text-text">
            Welcome to HexDesk
          </h1>
          <p className="text-lg text-muted">The Origin System, Connected.</p>
        </div>
        <p className="text-sm text-muted">
          Inventory and mastery tracking, market tools, timers, relic overlays and riven analysis in one local app. Built by Tenno, for Tenno.
        </p>
        <Button variant="primary" size="lg" trailingIcon={ArrowRight} onClick={onStart}>
          Get started
        </Button>
        {version && <p className="text-xs text-muted">Version {version}</p>}
      </div>
    </main>
  );
}

function Setup({ step, onStep }: { step: number; onStep: (step: number | null) => void }) {
  const finish = useSaveSettingsConfirmed();
  // Leaving the appearance step while the OCR models download would hide its progress and result.
  const ocrPending = useIsMutating({ mutationKey: ocrModelsMutationKey }) > 0;
  const Step = SETUP_STEPS[step] ?? SETUP_STEPS[0];
  const last = step === LAST_STEP;

  return (
    <main aria-labelledby="setup-title" className="flex min-h-0 flex-1 overflow-y-auto bg-bg">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-8 sm:px-10">
        <header className="mb-8 flex items-center gap-3">
          <HexDeskMark className="size-8 text-accent" />
          <h1 id="setup-title" className="text-lg font-semibold text-text">
            Set up HexDesk
          </h1>
          <Progress step={step} />
        </header>

        <section className="flex flex-1 flex-col rounded-xl border border-border bg-surface p-6 shadow-2 sm:p-8">
          <div className="mb-6">
            <Step />
          </div>
          {finish.isError && (
            <p role="alert" className="mt-5 text-sm text-danger">
              Could not finish setup: {String(finish.error)}
            </p>
          )}
          <footer className="mt-auto flex items-center justify-between gap-4 border-t border-border pt-6">
            <Button
              variant="ghost"
              leadingIcon={ArrowLeft}
              disabled={finish.isPending || ocrPending}
              onClick={() => {
                onStep(step === 0 ? null : step - 1);
              }}
            >
              Back
            </Button>
            {last ? (
              <Button
                variant="primary"
                loading={finish.isPending}
                onClick={() => {
                  finish.mutate({ onboardingCompleted: true });
                }}
              >
                Start using HexDesk
              </Button>
            ) : (
              <Button
                variant="primary"
                trailingIcon={ArrowRight}
                disabled={ocrPending}
                onClick={() => {
                  onStep(step + 1);
                }}
              >
                Continue
              </Button>
            )}
          </footer>
        </section>
      </div>
    </main>
  );
}

function Progress({ step }: { step: number }) {
  const total = String(SETUP_STEPS.length);
  return (
    <ol aria-label="Setup progress" className="ms-auto flex gap-2">
      {SETUP_STEPS.map((_, index) => (
        <li key={index}>
          <span className={index === step ? "block size-2.5 rounded-full bg-accent" : "block size-2.5 rounded-full bg-border-strong"}>
            <span className="sr-only">{`Step ${String(index + 1)} of ${total}${index === step ? ", current" : ""}`}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
