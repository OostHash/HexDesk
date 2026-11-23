import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../cn";
import { Icon } from "./Icon";
import { strings } from "../strings";

type AlertTone = "info" | "success" | "warning" | "danger";

const TONE: Record<AlertTone, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: "border-info/40 bg-info/10 [--alert:var(--hex-info)]" },
  success: { icon: CircleCheck, className: "border-success/40 bg-success/10 [--alert:var(--hex-success)]" },
  warning: { icon: TriangleAlert, className: "border-warning/40 bg-warning/10 [--alert:var(--hex-warning)]" },
  danger: { icon: CircleAlert, className: "border-danger/40 bg-danger/10 [--alert:var(--hex-danger)]" },
};

type Props = {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Optional action, e.g. a "Retry" button. */
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
};

/**
 * Inline message. danger/warning use role="alert" (announced immediately),
 * info/success role="status" (announced politely).
 */
export function Alert({ tone = "info", title, children, action, onDismiss, className }: Props) {
  const { icon, className: toneClass } = TONE[tone];
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-lg border p-3 text-sm text-text", toneClass, className)}
    >
      <Icon icon={icon} size="sm" className="mt-0.5 text-(--alert)" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-muted">{children}</div>}
        {action && <div className="mt-1">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label={strings.dismiss}
          onClick={onDismiss}
          className="inline-flex size-6 items-center justify-center rounded-sm text-muted hover:bg-hover hover:text-text"
        >
          <Icon icon={X} size="xs" />
        </button>
      )}
    </div>
  );
}
