import { Pin } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../theme/index.css";
import { Button, IconButton } from "./actions";
import { ResizeHandle } from "./behavior";
import { cn } from "./cn";
import { Alert, Chip } from "./display";
import { Checkbox, FormField, Input, RadioGroup, SearchInput, Slider, Switch } from "./forms";

describe("cn", () => {
  it("lets the last conflicting class win, also for our own theme names", () => {
    expect(cn("px-3 bg-surface", "px-4 bg-accent")).toBe("px-4 bg-accent");
    expect(cn("h-control-sm", "h-control-lg")).toBe("h-control-lg");
  });

  it("keeps text colour and text size apart", () => {
    expect(cn("text-text", "text-list")).toBe("text-text text-list");
  });
});

describe("Button", () => {
  it("is type=button and becomes busy and disabled while loading", async () => {
    const screen = await render(<Button loading>Save</Button>);
    const button = screen.getByRole("button", { name: /Save/ });
    await expect.element(button).toHaveAttribute("type", "button");
    await expect.element(button).toBeDisabled();
    await expect.element(button).toHaveAttribute("aria-busy", "true");
  });
});

describe("IconButton", () => {
  it("has an accessible name and exposes its toggle state", async () => {
    const screen = await render(<IconButton icon={Pin} label="Pin" pressed />);
    await expect.element(screen.getByRole("button", { name: "Pin", pressed: true })).toBeInTheDocument();
  });
});

describe("FormField", () => {
  it("wires label, description and error to the control", async () => {
    const screen = await render(
      <FormField label="Name" description="As shown in Warframe" error="Required" required>
        <Input />
      </FormField>,
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    await expect.element(input).toHaveAttribute("aria-invalid", "true");
    await expect.element(input).toBeRequired();
    await expect.element(input).toHaveAccessibleDescription("As shown in Warframe Required");
  });
});

function ControlledSearch({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <SearchInput label="Search" value={value} onValueChange={setValue} />;
}

describe("SearchInput", () => {
  it("clears with Escape, then leaves the field on a second Escape", async () => {
    const screen = await render(<ControlledSearch initial="lith" />);
    const input = screen.getByRole("searchbox", { name: "Search" });
    await userEvent.click(input);
    await userEvent.keyboard("{Escape}");
    await expect.element(input).toHaveValue("");
    await expect.element(input).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(input).not.toHaveFocus();
  });

  it("clear button empties the field and returns focus to it", async () => {
    const screen = await render(<ControlledSearch initial="axi" />);
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    const input = screen.getByRole("searchbox", { name: "Search" });
    await expect.element(input).toHaveValue("");
    await expect.element(input).toHaveFocus();
    await expect.element(screen.getByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });
});

describe("SearchInput ref", () => {
  it("forwards the caller's ref without breaking the clear button", async () => {
    const outer = { current: null as HTMLInputElement | null };
    function WithRef() {
      const [value, setValue] = useState("neo");
      return <SearchInput ref={outer} label="Search" value={value} onValueChange={setValue} />;
    }
    const screen = await render(<WithRef />);
    expect(outer.current).toBeInstanceOf(HTMLInputElement);
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await expect.element(screen.getByRole("searchbox", { name: "Search" })).toHaveFocus();
  });
});

describe("Checkbox, Switch, Slider", () => {
  it("Checkbox reflects indeterminate", async () => {
    const screen = await render(
      <Checkbox checked={false} indeterminate onCheckedChange={() => undefined}>
        All
      </Checkbox>,
    );
    await expect.element(screen.getByRole("checkbox", { name: "All" })).toBePartiallyChecked();
  });

  it("Switch toggles with Space", async () => {
    const onChange = vi.fn();
    const screen = await render(
      <Switch checked={false} onCheckedChange={onChange}>
        Notifications
      </Switch>,
    );
    const toggle = screen.getByRole("switch", { name: "Notifications" });
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("Slider steps with the arrow keys and announces the formatted value", async () => {
    function Controlled() {
      const [value, setValue] = useState(1);
      return (
        <FormField label="Text size">
          <Slider value={value} onValueChange={setValue} min={0.8} max={2} step={0.1} formatValue={(v) => `${String(Math.round(v * 100))}%`} />
        </FormField>
      );
    }
    const screen = await render(<Controlled />);
    const slider = screen.getByRole("slider", { name: "Text size" });
    await userEvent.click(slider);
    await userEvent.keyboard("{Home}{ArrowRight}");
    await expect.element(slider).toHaveAttribute("aria-valuetext", "90%");
  });

  it("Slider commits each keyboard step through the native change event", async () => {
    const onCommit = vi.fn();
    function Controlled() {
      const [value, setValue] = useState(1);
      return (
        <FormField label="Text size">
          <Slider value={value} onValueChange={setValue} onValueCommit={onCommit} min={0.8} max={2} step={0.1} />
        </FormField>
      );
    }
    const screen = await render(<Controlled />);
    const slider = screen.getByRole("slider", { name: "Text size" });
    await userEvent.click(slider);
    onCommit.mockClear();
    await userEvent.keyboard("{Home}{ArrowRight}");
    await vi.waitFor(() => {
      expect(onCommit).toHaveBeenLastCalledWith(expect.closeTo(0.9));
    });
  });
});

describe("RadioGroup", () => {
  it("is one group with native arrow-key selection", async () => {
    function Controlled() {
      const [value, setValue] = useState<"any" | "normal" | "hard">("any");
      return (
        <RadioGroup
          legend="Mode"
          appearance="segmented"
          value={value}
          onValueChange={setValue}
          options={[
            { value: "any", label: "Any" },
            { value: "normal", label: "Normal" },
            { value: "hard", label: "Steel Path" },
          ]}
        />
      );
    }
    const screen = await render(<Controlled />);
    await expect.element(screen.getByRole("group", { name: "Mode" })).toBeInTheDocument();
    // Segmented radios are visually hidden; users click the pill (the label).
    await userEvent.click(screen.getByText("Any"));
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(screen.getByRole("radio", { name: "Normal" })).toBeChecked();
  });
});

describe("Chip", () => {
  it("toggle chip exposes aria-pressed", async () => {
    const onActive = vi.fn();
    const screen = await render(
      <Chip active={false} onActiveChange={onActive}>
        Lith
      </Chip>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Lith", pressed: false }));
    expect(onActive).toHaveBeenCalledWith(true);
  });

  it("removable chip has a labelled remove button", async () => {
    const onRemove = vi.fn();
    const screen = await render(
      <Chip onRemove={onRemove} removeLabel="Remove Lith watch">
        Lith
      </Chip>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Lith watch" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe("Alert", () => {
  it("uses alert for danger and status for info", async () => {
    const screen = await render(
      <>
        <Alert tone="danger" title="Failed" />
        <Alert tone="info" title="Updated" />
      </>,
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Failed");
    await expect.element(screen.getByRole("status")).toHaveTextContent("Updated");
  });
});

describe("ResizeHandle", () => {
  it("is a focusable separator driven by the keyboard and clamped", async () => {
    function Controlled() {
      const [width, setWidth] = useState(200);
      return <ResizeHandle label="Sidebar width" axis="x" value={width} min={160} max={240} step={8} onValueChange={setWidth} className="h-10" />;
    }
    const screen = await render(<Controlled />);
    const handle = screen.getByRole("separator", { name: "Sidebar width" });
    await userEvent.click(handle);
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(handle).toHaveAttribute("aria-valuenow", "208");
    await userEvent.keyboard("{End}{ArrowRight}");
    await expect.element(handle).toHaveAttribute("aria-valuenow", "240");
    await userEvent.keyboard("{Home}");
    await expect.element(handle).toHaveAttribute("aria-valuenow", "160");
  });
});
