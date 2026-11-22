import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { emitWith } from "../../api/events";
import {
  hidePickPreview,
  hideRewardPreview,
  hideRivenPreview,
  overlayPrefsFrom,
  showPickPreview,
  showRewardPreview,
  showRivenPreview,
  useOverlayStatus,
} from "../../api/overlays";
import { useSaveSettings } from "../../api/settings";
import { OFFSET_LIMIT, OFFSET_STEP, offsetDraft, offsetOf, withOffset, type OffsetTarget, type OverlayOffsets } from "../../domain/overlayOffsets";
import { STATUS_DURATION_RANGE } from "../../domain/overlayStatus";
import { PICK_LINES, PICK_LINES_LABEL, PICK_PRIORITIES, PICK_PRIORITY_LABEL } from "../../domain/relicPick";
import { OVERLAY_PRIORITIES, OVERLAY_PRIORITY_LABEL } from "../../domain/relicReward";
import { Button } from "../../primitives/actions";
import { FormField, Input, Select, Slider } from "../../primitives/forms";
import { getPreferences } from "../../state/preferences";
import { ManualModeRow, OverlayKeyRow } from "./controls";
import { SettingRow, SettingsGroup, SwitchRow, useSettingsFile } from "./parts";

type Overlay = "reward" | "pick" | "riven";
const OVERLAYS: readonly Overlay[] = ["reward", "pick", "riven"];
const TARGET: Readonly<Record<Overlay, OffsetTarget>> = { reward: "relic", pick: "relicPick", riven: "riven" };
const show: Readonly<Record<Overlay, () => Promise<void>>> = {
  reward: () => showRewardPreview(getPreferences().textScale),
  pick: showPickPreview,
  riven: showRivenPreview,
};
const hide: Readonly<Record<Overlay, () => Promise<void>>> = { reward: hideRewardPreview, pick: hidePickPreview, riven: hideRivenPreview };
const quiet = (p: Promise<void>) => {
  p.catch((error: unknown) => {
    console.error("overlays: preview failed", error);
  });
};

/**
 * Which previews this tab shows. Live game data takes over a preview in the
 * overlay itself; leaving the tab (or closing Settings) hides them all.
 */
function usePreviews() {
  const [shown, setShown] = useState<ReadonlySet<Overlay>>(new Set());
  // Only set() changes the shown previews, and it updates this first.
  const current = useRef(shown);
  useEffect(
    () => () => {
      for (const o of current.current) quiet(hide[o]());
    },
    [],
  );
  const set = (overlays: readonly Overlay[], on: boolean) => {
    for (const o of overlays) if (current.current.has(o) !== on) quiet(on ? show[o]() : hide[o]());
    const next = new Set(current.current);
    for (const o of overlays) {
      if (on) next.add(o);
      else next.delete(o);
    }
    current.current = next;
    setShown(next);
  };
  return { shown, set };
}

function PreviewButton({ shown, onToggle, description, all = false }: { shown: boolean; onToggle: () => void; description: string; all?: boolean }) {
  return (
    <SettingRow label={all ? "Previews" : "Preview"} description={description}>
      <Button size="sm" aria-pressed={shown} leadingIcon={shown ? EyeOff : Eye} onClick={onToggle}>
        {all ? (shown ? "Hide all previews" : "Show all previews") : shown ? "Hide preview" : "Show preview"}
      </Button>
    </SettingRow>
  );
}

/** One offset field. It keeps what is typed until it is a number, and shows the saved value otherwise. */
function OffsetField({ label, value, disabled, onCommit }: { label: string; value: number; disabled: boolean; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(String(value));
  }, [value]);
  return (
    <FormField label={label} className="w-24">
      <Input
        ref={ref}
        type="number"
        size="sm"
        inputMode="numeric"
        min={-OFFSET_LIMIT}
        max={OFFSET_LIMIT}
        step={OFFSET_STEP}
        value={draft}
        disabled={disabled}
        className="text-end tabular-nums"
        onChange={(event) => {
          setDraft(event.target.value);
          const n = offsetDraft(event.target.value);
          if (n !== null && n !== value) onCommit(n);
        }}
        onBlur={() => {
          if (offsetDraft(draft) === null) setDraft(String(value));
        }}
      />
    </FormField>
  );
}

function OffsetRow({
  target,
  offsets,
  disabled,
  onChange,
}: {
  target: OffsetTarget;
  offsets: OverlayOffsets;
  disabled: boolean;
  onChange: (next: OverlayOffsets) => void;
}) {
  const { x, y } = offsetOf(offsets, target);
  return (
    <SettingRow label="Position offset" description="Moves the overlay this many pixels from its built-in spot. 0 keeps the built-in spot.">
      <div className="flex items-end gap-2">
        <OffsetField
          label="X offset"
          value={x}
          disabled={disabled}
          onCommit={(v) => {
            onChange(withOffset(offsets, target, { x: v }));
          }}
        />
        <OffsetField
          label="Y offset"
          value={y}
          disabled={disabled}
          onCommit={(v) => {
            onChange(withOffset(offsets, target, { y: v }));
          }}
        />
        <Button
          size="sm"
          disabled={disabled || (x === 0 && y === 0)}
          onClick={() => {
            onChange(withOffset(offsets, target, { x: 0, y: 0 }));
          }}
        >
          Reset
        </Button>
      </div>
    </SettingRow>
  );
}

/** Settings → Overlays. */
export function OverlaysTab() {
  const { settings, set } = useSettingsFile();
  const { mutateAsync } = useSaveSettings();
  const prefs = overlayPrefsFrom(settings);
  const statusPrefs = prefs.status;
  const statusText = useOverlayStatus();
  const previews = usePreviews();
  const allShown = OVERLAYS.every((o) => previews.shown.has(o));

  // The backend reads the relic offsets from the settings file, so a shown
  // preview moves only once the save has landed.
  const saveOffsets = (overlay?: Overlay) => (next: OverlayOffsets) => {
    void mutateAsync({ overlayOffsets: next }).then(
      () => {
        if (overlay && previews.shown.has(overlay)) quiet(show[overlay]());
      },
      (error: unknown) => {
        console.error("overlays: saving offsets failed", error);
      },
    );
  };

  return (
    <>
      <SettingsGroup title="All overlays">
        <SwitchRow
          label="Enable overlays"
          description="Show overlays over the game automatically. Off hides every overlay and preview."
          checked={prefs.overlaysEnabled}
          onCheckedChange={(on) => {
            // The main window tells the backend (RelicOverlayController).
            set({ overlaysEnabled: on });
            if (!on) previews.set(OVERLAYS, false);
          }}
        />
        <OverlayKeyRow />
        <ManualModeRow />
        <PreviewButton
          all
          shown={allShown}
          description="Show every overlay with example data at once."
          onToggle={() => {
            previews.set(OVERLAYS, !allShown);
          }}
        />
      </SettingsGroup>

      <SettingsGroup title="Status">
        {statusText && (
          <div>
            <p role="status" className="font-mono text-xs text-success">
              {statusText}
            </p>
          </div>
        )}
        <SwitchRow
          label="Show status overlay"
          description="Show what the overlays are doing at the top centre of the game."
          checked={statusPrefs.enabled}
          onCheckedChange={(enabled) => {
            set({ overlayStatus: { ...statusPrefs, enabled } });
          }}
        />
        <FormField layout="row" label="Display time" description="How long the latest status stays on screen.">
          <Slider
            className="w-56"
            min={STATUS_DURATION_RANGE.min}
            max={STATUS_DURATION_RANGE.max}
            value={statusPrefs.durationSeconds}
            disabled={!statusPrefs.enabled}
            formatValue={(seconds) => `${String(seconds)} s`}
            onValueChange={(durationSeconds) => {
              set({ overlayStatus: { ...statusPrefs, durationSeconds } });
            }}
          />
        </FormField>
        <OffsetRow target="status" offsets={prefs.offsets} disabled={!statusPrefs.enabled} onChange={saveOffsets()} />
        <SettingRow label="Preview" description="Show the status line with example text.">
          <Button
            size="sm"
            disabled={!statusPrefs.enabled}
            onClick={() => {
              void mutateAsync({ overlayStatus: statusPrefs }).then(
                () => emitWith("status-line", "Overlay status preview"),
                (error: unknown) => {
                  console.error("overlays: saving status settings failed", error);
                },
              );
            }}
          >
            Show preview
          </Button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Relic reward overlay">
        <SwitchRow
          label="Enable"
          description="Show reward cards when the Void Fissure reward screen opens."
          checked={prefs.rewardEnabled}
          onCheckedChange={(on) => {
            set({ overlayEnabled: on });
            if (!on) void emitWith("relic-screen", true);
          }}
        />
        <FormField layout="row" label="Best pick" description="Which card the overlay highlights as the best pick.">
          <Select
            className="w-48"
            value={prefs.rewardPriority}
            disabled={!prefs.rewardEnabled}
            onChange={(event) => {
              set({ overlayPriority: event.target.value });
            }}
          >
            {OVERLAY_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {OVERLAY_PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        </FormField>
        <OffsetRow target={TARGET.reward} offsets={prefs.offsets} disabled={!prefs.rewardEnabled} onChange={saveOffsets("reward")} />
        <PreviewButton
          shown={previews.shown.has("reward")}
          description="Example cards; real rewards take over during a run."
          onToggle={() => {
            previews.set(["reward"], !previews.shown.has("reward"));
          }}
        />
      </SettingsGroup>

      <SettingsGroup title="Relic pick overlay">
        <SwitchRow
          label="Enable"
          description="Recommend relics when the relic selection screen opens."
          checked={prefs.relicPickEnabled}
          onCheckedChange={(on) => {
            // The main window tells the backend (RelicOverlayController).
            set({ relicPickEnabled: on });
          }}
        />
        <FormField layout="row" label="Recommend by" description="How the overlay ranks your relics.">
          <Select
            className="w-48"
            value={prefs.pickPriority}
            disabled={!prefs.relicPickEnabled}
            onChange={(event) => {
              set({ relicPickPriority: event.target.value });
            }}
          >
            {PICK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PICK_PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField layout="row" label="Shown per relic" description="How much reward detail each relic shows.">
          <Select
            className="w-48"
            value={prefs.pickLines}
            disabled={!prefs.relicPickEnabled}
            onChange={(event) => {
              set({ relicPickLines: event.target.value });
            }}
          >
            {PICK_LINES.map((l) => (
              <option key={l} value={l}>
                {PICK_LINES_LABEL[l]}
              </option>
            ))}
          </Select>
        </FormField>
        <OffsetRow target={TARGET.pick} offsets={prefs.offsets} disabled={!prefs.relicPickEnabled} onChange={saveOffsets("pick")} />
        <PreviewButton
          shown={previews.shown.has("pick")}
          description="Example relics; your relics take over in the game."
          onToggle={() => {
            previews.set(["pick"], !previews.shown.has("pick"));
          }}
        />
      </SettingsGroup>

      <SettingsGroup title="Riven overlay">
        <SwitchRow
          label="Enable"
          description="Check the riven when a riven card screen opens."
          checked={prefs.rivenEnabled}
          onCheckedChange={(on) => {
            set({ rivenEnabled: on });
          }}
        />
        <OffsetRow target={TARGET.riven} offsets={prefs.offsets} disabled={!prefs.rivenEnabled} onChange={saveOffsets("riven")} />
        <PreviewButton
          shown={previews.shown.has("riven")}
          description="An example roll; a real check takes over."
          onToggle={() => {
            previews.set(["riven"], !previews.shown.has("riven"));
          }}
        />
      </SettingsGroup>
    </>
  );
}
