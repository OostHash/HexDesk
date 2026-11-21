import { useIsMutating } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import { ocrModelsMutationKey, useSaveSettingsConfirmed } from "../../../api/settings";
import { HexDeskMark } from "../../../patterns/HexDeskMark";
import { Button } from "../../../primitives/actions";
import { STEPS } from "./steps";

const LAST_STEP = STEPS.length - 1;

/** Full-page first-run setup for appearance, privacy and testing consent. */
export function WelcomeScreen() {
  const [step, setStep] = useState(0);
  const finish = useSaveSettingsConfirmed();
  // Leaving the first step while the OCR models download would hide its progress and result.
  const ocrPending = useIsMutating({ mutationKey: ocrModelsMutationKey }) > 0;
  const Step = STEPS[step] ?? STEPS[0];

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
          <Progress step={step} />
        </header>

        <section className="flex flex-1 flex-col rounded-xl border border-border bg-surface p-6 shadow-2 sm:p-8">
          <Step />
          {finish.isError && (
            <p role="alert" className="mt-5 text-sm text-danger">
              Could not finish setup: {String(finish.error)}
            </p>
          )}
          <footer className="mt-auto flex items-center justify-between gap-4 border-t border-border pt-6">
            <Button
              variant="ghost"
              leadingIcon={ArrowLeft}
              disabled={step === 0 || finish.isPending}
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
              <Button
                variant="primary"
                loading={finish.isPending}
                onClick={() => {
                  finish.mutate({ onboardingCompleted: true });
                }}
              >
                Start using HexDesk
              </Button>
            )}
          </footer>
        </section>
      </div>
    </main>
  );
}

function Progress({ step }: { step: number }) {
  const total = String(STEPS.length);
  return (
    <ol aria-label="Setup progress" className="ms-auto flex gap-2">
      {STEPS.map((_, index) => (
        <li key={index}>
          <span className={index === step ? "block size-2.5 rounded-full bg-accent" : "block size-2.5 rounded-full bg-border-strong"}>
            <span className="sr-only">{`Step ${String(index + 1)} of ${total}${index === step ? ", current" : ""}`}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
