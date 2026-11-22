import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "../actions/IconButton";
import { cn } from "../cn";
import { strings } from "../strings";

const SIZE = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" } as const;

type Props = {
  open: boolean;
  /** Called on Escape, the close button, or a backdrop click. The parent sets open=false. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZE;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  /** Hide the × in the header (e.g. ConfirmDialog, which has explicit buttons). */
  hideCloseButton?: boolean;
  className?: string;
  children?: ReactNode;
};

/**
 * Modal dialog on the native <dialog> element. showModal() gives
 * the top layer, a focus trap, an inert background, Escape handling (only
 * the topmost dialog receives it) and focus restore on close.
 * Initial focus: the first element with `autoFocus`, otherwise the first
 * focusable element.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = "md",
  closeOnBackdrop = true,
  closeOnEscape = true,
  hideCloseButton = false,
  className,
  children,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Unmounting while open must also release the top layer.
  useEffect(
    () => () => {
      ref.current?.close();
    },
    [],
  );

  // Backdrop click is a mouse convenience; keyboard users close with Escape or
  // the close button, so no key handler is needed on the <dialog> itself.
  /* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // React propagates `cancel` from a nested dialog to this one; only
        // the dialog that received Escape may react.
        if (event.target !== event.currentTarget) return;
        // Escape: keep the dialog open until the parent decides (controlled).
        event.preventDefault();
        if (closeOnEscape) onClose();
      }}
      onClick={(event) => {
        // A click on the <dialog> itself (not its content) is a backdrop click.
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "m-auto max-h-[85dvh] w-full overflow-hidden rounded-lg border border-border bg-surface-raised p-0 text-text shadow-3",
        "backdrop:bg-backdrop open:flex open:flex-col",
        SIZE[size],
        className,
      )}
    >
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="text-sm text-muted">
              {description}
            </p>
          )}
        </div>
        {!hideCloseButton && <IconButton icon={X} label={strings.close} size="sm" onClick={onClose} />}
      </header>
      {children !== undefined && <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>}
      {footer && <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">{footer}</footer>}
    </dialog>
  );
  /* eslint-enable jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */
}
