import type { ReactNode } from "react";
import { Button } from "../actions/Button";
import { Modal } from "./Modal";
import { strings } from "../strings";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions get a danger button and initial focus on Cancel. */
  destructive?: boolean;
  /** Shows a spinner on the confirm button and blocks closing. */
  busy?: boolean;
};

/** Yes/no confirmation; a thin composition on Modal. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = strings.confirm,
  cancelLabel = strings.cancel,
  destructive = false,
  busy = false,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      description={description}
      size="sm"
      hideCloseButton
      closeOnBackdrop={!busy}
      footer={
        // autoFocus inside a <dialog> is the native way to choose initial focus
        // (HTML dialog focusing steps); jsx-a11y flags every autoFocus.
        /* eslint-disable jsx-a11y/no-autofocus */
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} autoFocus={destructive}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} loading={busy} autoFocus={!destructive}>
            {confirmLabel}
          </Button>
        </>
        /* eslint-enable jsx-a11y/no-autofocus */
      }
    />
  );
}
