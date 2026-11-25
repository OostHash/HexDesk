import { Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../theme/index.css";
import { Button } from "../actions/Button";
import { Menu } from "../actions/Menu";
import { ConfirmDialog, Modal, Popover, Tooltip, ToastRegion, toast, toastQueue } from ".";

function ModalHarness({ withPopover = false, nested = false }: { withPopover?: boolean; nested?: boolean }) {
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Open modal
      </Button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Recipe"
        footer={
          <Button
            onClick={() => {
              setOpen(false);
            }}
          >
            Done
          </Button>
        }
      >
        <p>Content</p>
        {withPopover && (
          <Popover
            label="Details"
            trigger={(props) => (
              <button type="button" {...props}>
                Details
              </button>
            )}
          >
            Popover content
          </Popover>
        )}
        {nested && (
          <Button
            onClick={() => {
              setInner(true);
            }}
          >
            Open second
          </Button>
        )}
        {nested && (
          <Modal
            open={inner}
            onClose={() => {
              setInner(false);
            }}
            title="Second"
          >
            Inner content
          </Modal>
        )}
      </Modal>
    </>
  );
}

describe("Modal", () => {
  it("opens as a named dialog, closes on Escape and restores focus", async () => {
    const screen = await render(<ModalHarness />);
    const trigger = screen.getByRole("button", { name: "Open modal" });
    await userEvent.click(trigger);
    const dialog = page.getByRole("dialog", { name: "Recipe" });
    await expect.element(dialog).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  });

  it("closes on a backdrop click, not on a press that starts inside and ends outside", async () => {
    const screen = await render(<ModalHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Open modal" }));
    const dialog = page.getByRole("dialog", { name: "Recipe" });
    const element = dialog.element();
    // Content that shrinks under the pointer: the press starts on the content
    // and the click lands on the <dialog>, their common ancestor.
    screen
      .getByText("Content")
      .element()
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await expect.element(dialog).toBeVisible();
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await expect.element(dialog).not.toBeInTheDocument();
  });

  it("Escape closes a popover inside the modal first, then the modal", async () => {
    const screen = await render(<ModalHarness withPopover />);
    await userEvent.click(screen.getByRole("button", { name: "Open modal" }));
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    const popover = page.getByRole("dialog", { name: "Details" });
    await expect.element(popover).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(popover).not.toBeInTheDocument();
    await expect.element(page.getByRole("dialog", { name: "Recipe" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog", { name: "Recipe" })).not.toBeInTheDocument();
  });

  it("stacked modals close top-down", async () => {
    const screen = await render(<ModalHarness nested />);
    await userEvent.click(screen.getByRole("button", { name: "Open modal" }));
    await userEvent.click(screen.getByRole("button", { name: "Open second" }));
    await expect.element(page.getByRole("dialog", { name: "Second" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog", { name: "Second" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("dialog", { name: "Recipe" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Open second" })).toHaveFocus();
  });
});

describe("ConfirmDialog", () => {
  it("focuses Cancel first for destructive actions", async () => {
    const onConfirm = vi.fn();
    const screen = await render(
      <ConfirmDialog open destructive onClose={() => undefined} onConfirm={onConfirm} title="Delete watch?" confirmLabel="Delete" />,
    );
    await expect.element(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("Popover", () => {
  it("toggles from its trigger, reports state and closes on Escape", async () => {
    const onOpenChange = vi.fn();
    const screen = await render(
      <Popover
        label="Filters"
        onOpenChange={onOpenChange}
        trigger={(props) => (
          <button type="button" {...props}>
            Filters
          </button>
        )}
      >
        Content
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Filters" });
    await userEvent.click(trigger);
    await expect.element(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});

describe("Tooltip", () => {
  it("describes its trigger and shows on focus, hides on Escape", async () => {
    const screen = await render(
      <Tooltip content="Pin in the modular window">
        {(props) => (
          <button type="button" {...props}>
            Pin
          </button>
        )}
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Pin" });
    await expect.element(trigger).toHaveAccessibleDescription("Pin in the modular window");
    await userEvent.tab();
    await expect.element(page.getByRole("tooltip")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("Menu", () => {
  it("is keyboard operable and returns focus to the trigger", async () => {
    const onCopy = vi.fn();
    const screen = await render(
      <Menu
        trigger="Actions"
        items={[
          { id: "copy", label: "Copy", icon: Copy, onAction: onCopy },
          { id: "sep", separator: true },
          { id: "delete", label: "Delete", icon: Trash2, onAction: () => undefined, danger: true, disabled: true },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Actions" });
    // Keyboard open moves focus to the first item (pointer open does not).
    (trigger.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowDown}");
    const menu = page.getByRole("menu");
    await expect.element(menu).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Enter}");
    expect(onCopy).toHaveBeenCalledOnce();
    await expect.element(menu).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
  });
});

describe("Toast", () => {
  afterEach(() => {
    for (const item of toastQueue.visibleToasts) toastQueue.close(item.key);
  });

  it("announces a toast in a labelled region and closes it", async () => {
    await render(<ToastRegion />);
    toast({ title: "Watch added", tone: "success" });
    const region = page.getByRole("region", { name: "Notifications" });
    await expect.element(region).toHaveTextContent("Watch added");
    await userEvent.click(page.getByRole("button", { name: "Dismiss" }));
    await expect.element(region).not.toBeInTheDocument();
  });
});
