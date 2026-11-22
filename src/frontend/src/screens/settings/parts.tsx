import { Info } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useSaveSettings, useSettings, type SettingsFile } from "../../api/settings";
import { Icon } from "../../primitives/display";
import { Switch } from "../../primitives/forms";
import { Tooltip } from "../../primitives/overlay";

/** The settings file plus a setter for some of its top-level keys. */
export function useSettingsFile(): { settings: SettingsFile; set: (patch: SettingsFile) => void } {
  const { data } = useSettings();
  const { mutate } = useSaveSettings();
  return { settings: data ?? {}, set: mutate };
}

/**
 * A titled group of settings: the heading above, the rows in one card below.
 * Every direct child is a row of the card, with a divider between rows.
 */
export function SettingsGroup({ title, badge, children }: { title: ReactNode; badge?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-muted uppercase">
        {title}
        {badge}
      </h3>
      <SettingsCard>{children}</SettingsCard>
    </section>
  );
}

/** The card of a `SettingsGroup` without its heading: every direct child is a row, with a divider between rows. */
export function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface *:px-4 *:py-3">{children}</div>;
}

type SettingRowProps = {
  label: ReactNode;
  description?: ReactNode;
  /** The id of the control, so the visible label is its label. */
  htmlFor?: string;
  /** A result line under the row ("Cache cleared.", an error). */
  result?: ReactNode;
  /**
   * False when the control names itself (a RadioGroup with its own legend):
   * the row is then no group and its visible label is hidden from assistive tech.
   */
  group?: boolean;
  /** Extra help behind an "i" next to the label, on hover and focus. */
  info?: ReactNode;
  children: ReactNode;
};

/**
 * One setting: what it is and what it does on the left, the control on the
 * right. It wraps the control below the text when the dialog is narrow.
 */
export function SettingRow({ label, description, htmlFor, result, group = true, info, children }: SettingRowProps) {
  const id = useId();
  const Label = htmlFor ? "label" : "span";
  const isGroup = group && !htmlFor;
  return (
    <div role={isGroup ? "group" : undefined} aria-labelledby={isGroup ? id : undefined} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-56 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <Label id={id} htmlFor={htmlFor} aria-hidden={group || htmlFor ? undefined : true} className="text-sm font-medium text-text">
              {label}
            </Label>
            {info && <InfoTip>{info}</InfoTip>}
          </div>
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
      </div>
      {result}
    </div>
  );
}

type SwitchRowProps = {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
};

/** A setting row with a switch on the right; the label and description name and describe it. */
export function SwitchRow({ label, description, checked, onCheckedChange, disabled }: SwitchRowProps) {
  const switchId = useId();
  const descriptionId = useId();
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor={switchId} className={disabled ? "text-sm font-medium text-text opacity-50" : "cursor-pointer text-sm font-medium text-text"}>
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-xs text-muted">
            {description}
          </p>
        )}
      </div>
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
      />
    </div>
  );
}

/** An "i" button that shows extra help in a tooltip on hover and keyboard focus. */
export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <Tooltip content={children} delay={150}>
      {(trigger) => (
        <button
          type="button"
          aria-label="More info"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-text"
          {...trigger}
        >
          <Icon icon={Info} />
        </button>
      )}
    </Tooltip>
  );
}

/** A short result line under an action ("Cache cleared.", an error). */
export function ResultText({ tone, children }: { tone: "success" | "danger"; children: ReactNode }) {
  return (
    <p role="status" className={tone === "success" ? "text-xs text-success" : "text-xs text-danger"}>
      {children}
    </p>
  );
}
