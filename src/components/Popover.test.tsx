import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PopoverMenu } from "./Popover";
import { useModalSurface } from "./FloatingSurface";

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

function Harness({ dir = "ltr", onPick = () => undefined }: { dir?: "ltr" | "rtl"; onPick?: (value: string | number) => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.documentElement.dir = dir;
  }, [dir]);
  return (
    <>
      <button ref={anchor} onClick={() => setOpen(true)}>
        Open
      </button>
      {open && <PopoverMenu anchor={anchor.current} options={options} value="b" onPick={onPick} onClose={() => setOpen(false)} />}
    </>
  );
}

describe.each(["ltr", "rtl"] as const)("PopoverMenu keyboard behavior in %s", (dir) => {
  it("focuses the selected option and supports Arrow/Home/End selection", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness dir={dir} onPick={onPick} />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Beta" })).toHaveFocus());

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onPick).toHaveBeenCalledWith("c");
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{End}{Home}{Enter}");
    expect(onPick).toHaveBeenLastCalledWith("a");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness dir={dir} />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });
});

function TestModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useModalSurface({ surfaceRef: dialogRef, onClose, initialFocusRef: inputRef });
  return createPortal(
    <div data-modal-root>
      <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
        <input ref={inputRef} aria-label="Search" />
        <button onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  );
}

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="app-root">
      <button onClick={() => setOpen(true)}>Launch modal</button>
      {open && <TestModal onClose={() => setOpen(false)} />}
    </div>
  );
}

describe("modal focus management", () => {
  it("focuses inside, makes the background inert, traps Tab and restores focus", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const trigger = screen.getByRole("button", { name: "Launch modal" });
    await user.click(trigger);

    expect(screen.getByRole("textbox", { name: "Search" })).toHaveFocus();
    expect(screen.getByTestId("app-root").parentElement).toHaveProperty("inert", true);

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByTestId("app-root").parentElement).toHaveProperty("inert", false);
  });
});
