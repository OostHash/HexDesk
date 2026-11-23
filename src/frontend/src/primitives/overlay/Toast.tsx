import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import {
  Button as AriaButton,
  Text,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as AriaToastRegion,
} from "react-aria-components";
import { cn } from "../cn";
import { Icon } from "../display/Icon";
import { strings } from "../strings";

/**
 * In-app notifications on React Aria's toast region: an aria-live
 * landmark (F6 reaches it), pause on hover and focus, close button.
 * React Aria still marks the API UNSTABLE_; it is wrapped here so a change
 * stays inside this file. OS notifications stay with the notification plugin.
 */

export type ToastTone = "info" | "success" | "warning" | "danger";

export type ToastContent = {
  title: string;
  description?: string;
  tone?: ToastTone;
};

const TONE: Record<ToastTone, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: "text-info" },
  success: { icon: CircleCheck, className: "text-success" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  danger: { icon: CircleAlert, className: "text-danger" },
};

/** One queue per window. */
export const toastQueue = new ToastQueue<ToastContent>({ maxVisibleToasts: 4 });

/** Shows a toast. Default timeout 5 s; errors stay until closed. */
export function toast(content: ToastContent, options?: { timeout?: number }) {
  const timeout = options?.timeout ?? (content.tone === "danger" ? undefined : 5000);
  return toastQueue.add(content, timeout === undefined ? {} : { timeout });
}

/** Mount once per window (AppProviders). */
export function ToastRegion() {
  return (
    <AriaToastRegion
      queue={toastQueue}
      aria-label={strings.notifications}
      className="fixed end-4 bottom-4 z-(--hex-z-toast) flex w-80 flex-col-reverse gap-2 outline-none"
    >
      {({ toast: item }) => {
        const tone = TONE[item.content.tone ?? "info"];
        return (
          <AriaToast
            toast={item}
            className="flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-3 text-sm text-text shadow-2 outline-none data-focus-visible:outline-2 data-focus-visible:outline-focus"
          >
            <Icon icon={tone.icon} size="sm" className={cn("mt-0.5", tone.className)} />
            <AriaToastContent className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Text slot="title" className="font-semibold">
                {item.content.title}
              </Text>
              {item.content.description && (
                <Text slot="description" className="text-muted">
                  {item.content.description}
                </Text>
              )}
            </AriaToastContent>
            <AriaButton
              slot="close"
              aria-label={strings.dismiss}
              className="inline-flex size-6 items-center justify-center rounded-sm text-muted outline-none hover:bg-hover hover:text-text data-focus-visible:outline-2 data-focus-visible:outline-focus"
            >
              <Icon icon={X} size="xs" />
            </AriaButton>
          </AriaToast>
        );
      }}
    </AriaToastRegion>
  );
}
