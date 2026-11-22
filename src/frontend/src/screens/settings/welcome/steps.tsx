import {
  Bug,
  ExternalLink,
  FileArchive,
  Gamepad2,
  Keyboard,
  Lightbulb,
  Megaphone,
  Monitor,
  Send,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import discordQr from "../../../assets/welcome/discord-qr.svg";
import { openExternal } from "../../../api/links";
import { useOverlayPrefs } from "../../../api/overlays";
import { keyLabel } from "../../../domain/overlayKey";
import { DiscordMark } from "../../../patterns/DiscordMark";
import { Button } from "../../../primitives/actions";
import { Icon } from "../../../primitives/display";
import {
  DensityRow,
  ManualModeRow,
  MemoryScannerBadge,
  MemoryScannerRow,
  OcrModelsRow,
  OverlayKeyRow,
  TestingRows,
  TextSizeRow,
  ThemeRow,
} from "../controls";
import { SettingsCard, SettingsGroup } from "../parts";

/** The invite `src/frontend/src/assets/welcome/discord-qr.svg` encodes; regenerate the image when it changes. */
const DISCORD_URL = "https://discord.gg/GTCrhPMPQY";

/** The setup pages after the welcome page, in order. */
export const SETUP_STEPS = [AppearanceStep, MemoryScannerStep, OverlaysStep, TestingStep, CommunityStep] as const;

function StepHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </div>
  );
}

function AppearanceStep() {
  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="Make it yours">How HexDesk looks and how it reads the game. Both can be changed later in Settings → General.</StepHeading>
      <SettingsGroup title="Appearance">
        <ThemeRow />
        <DensityRow />
        <TextSizeRow />
      </SettingsGroup>
      <SettingsGroup title="Screen reading">
        <div className="flex flex-col gap-2 text-sm text-muted">
          <p>
            The overlays read the game screen: your relic list, the reward cards after a fissure and the stats on a riven. HexDesk uses the text
            recognition built into Windows for this, so it works without any download.
          </p>
          <p>
            Windows often misses small text, such as relic counts and the refinement tag on a relic. The open-source ocrs models read that text
            better. Turn them on to download them once; a read can take a moment longer.
          </p>
        </div>
        <OcrModelsRow description="About 12 MB, downloaded once. You can turn them off again at any time." />
      </SettingsGroup>
    </div>
  );
}

function MemoryScannerStep() {
  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="Your inventory">
        HexDesk can read your inventory straight from the running game: what you own, how many, mastery and mod ranks. It is off until you turn it on,
        and can be changed later in Settings → General.
      </StepHeading>
      <p className="text-sm text-muted">
        The memory scanner only reads; it never changes the game. Without it, Inventory, quantity tracking and mod ranks stay empty, while the
        overlays, market tools and timers work as usual.
      </p>
      <p className="flex items-start gap-2 rounded-lg border border-warning/50 bg-surface-raised p-3 text-xs text-muted">
        <Icon icon={ShieldAlert} size="sm" className="mt-0.5 shrink-0 text-warning" />
        Reading another program&apos;s memory is a grey area in the Warframe EULA. DE has tolerated read-only tools so far, but has never given
        explicit permission. Turn it on only if you accept that risk.
      </p>
      <SettingsGroup title="Memory scanner" badge={<MemoryScannerBadge />}>
        <MemoryScannerRow />
      </SettingsGroup>
    </div>
  );
}

function OverlaysStep() {
  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="Overlays in the game">
        When you open the relic selection, the fissure rewards or a riven, HexDesk shows prices and details over the game. Pick the key that controls
        them.
      </StepHeading>
      <SettingsCard>
        <OverlayKeyRow />
        <ManualModeRow />
      </SettingsCard>
    </div>
  );
}

function TestingStep() {
  const keys = useOverlayPrefs().testingKeys;
  return (
    <div className="flex flex-col gap-6">
      <StepHeading title="Help improve HexDesk">
        Testers tell HexDesk when it read a game screen wrong, so screen reading gets better for everyone. It is optional and off until you turn it
        on.
      </StepHeading>
      <ol className="grid gap-3 md:grid-cols-2">
        <HowStep number={1} icon={Gamepad2} title="Play as usual">
          After you pick a relic reward, refine a relic or look at a riven, HexDesk asks over the game whether it read the screen correctly.
        </HowStep>
        <HowStep number={2} icon={Keyboard} title="Answer with one key">
          <kbd className="font-semibold text-text">{keyLabel(keys.correct)}</kbd> if it was right; HexDesk forgets those screens.{" "}
          <kbd className="font-semibold text-text">{keyLabel(keys.wrong)}</kbd> if something was wrong; HexDesk keeps them for your report. You choose
          both keys below.
        </HowStep>
        <HowStep number={3} icon={FileArchive} title="Export when you are done">
          The screens you marked wrong wait at the top of HexDesk, next to your account. Export them as one zip in your Downloads folder whenever you
          like, or discard them.
        </HowStep>
        <HowStep number={4} icon={Send} title="Send it to us">
          Post the zip in the HexDesk Discord, or attach it to an issue on GitHub. That is how a wrong read gets fixed.
        </HowStep>
      </ol>
      <p className="flex items-start gap-2 text-xs text-muted">
        <Icon icon={ShieldCheck} size="sm" className="mt-0.5 shrink-0 text-accent" />
        Nothing is uploaded automatically. The zip holds only the screens you marked wrong and what HexDesk read on them: no logs, settings or account
        data.
      </p>
      <SettingsCard>
        <TestingRows />
      </SettingsCard>
      <p className="text-xs text-muted">
        Apart from testing, HexDesk keeps a local log for troubleshooting. You can choose how long it is kept and remove it in Settings → Console.
      </p>
    </div>
  );
}

function HowStep({ number, icon, title, children }: { number: number; icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-lg border border-border bg-surface-raised p-4">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{number}</span>
      <div className="flex flex-col gap-1">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Icon icon={icon} size="sm" className="text-muted" />
          {title}
        </h3>
        <p className="text-xs text-muted">{children}</p>
      </div>
    </li>
  );
}

function CommunityStep() {
  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <div className="flex flex-col items-center gap-3">
        {/* Discord's brand assets come in white and black; the text colour is one of the two in every theme. */}
        <span className="flex size-16 items-center justify-center rounded-2xl border border-border bg-surface-raised text-text">
          <DiscordMark className="size-9" />
        </span>
        <h2 className="text-2xl font-semibold">Join the HexDesk community</h2>
        <p className="max-w-lg text-sm text-muted">
          The Discord is where players ask questions, report bugs and share test reports, and where new versions are announced first.
        </p>
      </div>

      <ul className="flex flex-wrap justify-center gap-2">
        <Perk icon={Bug}>Report a bug</Perk>
        <Perk icon={FileArchive}>Share a test report</Perk>
        <Perk icon={Lightbulb}>Suggest a feature</Perk>
        <Perk icon={Megaphone}>Hear about updates first</Perk>
      </ul>

      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        <section className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface-raised p-6">
          <Icon icon={Monitor} size="lg" className="text-muted" />
          <div>
            <h3 className="font-medium">On this computer</h3>
            <p className="mt-1 text-xs text-muted">Opens the invite in your browser or the Discord app.</p>
          </div>
          <Button variant="primary" size="lg" trailingIcon={ExternalLink} onClick={() => void openExternal(DISCORD_URL)}>
            <DiscordMark className="size-4" />
            Join the Discord
          </Button>
        </section>
        <section className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface-raised p-6">
          {/* The image carries its own white quiet zone: phones need dark modules on a light field, whatever the theme. */}
          <img src={discordQr} alt="QR code for the HexDesk Discord invite" className="size-36 rounded-lg" />
          <div>
            <h3 className="font-medium">On your phone</h3>
            <p className="mt-1 text-xs text-muted">Scan the code with your camera.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Perk({ icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <li className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1 text-xs text-muted">
      <Icon icon={icon} size="sm" className="text-accent" />
      {children}
    </li>
  );
}
