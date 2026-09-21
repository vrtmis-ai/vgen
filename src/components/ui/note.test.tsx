import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Note, NoteAction } from "./note";

/* ---------------------------------------------------------------------------
   The notice every failure in the app is now drawn as.

   What is worth guarding is the `label` prop, because it is the one thing that
   changes the shape rather than the colour: `true` draws the tone's icon, a
   string draws «label:» in bold instead, and `false` draws neither. A tile too
   short for a reason passes `false`, and a bold colon with nothing after it was
   the bug that argued for the third case.
   --------------------------------------------------------------------------- */

describe("Note", () => {
  it("draws the tone's icon when the label is left alone", () => {
    const { container } = render(<Note type="error">اعتبار کافی نیست</Note>);

    expect(screen.getByText("اعتبار کافی نیست")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("swaps the icon for a named label", () => {
    const { container } = render(
      <Note type="error" label="انجام نشد">
        دلیلش
      </Note>,
    );

    expect(screen.getByText("انجام نشد:")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("draws neither when the label is refused", () => {
    const { container } = render(<Note label={false}>تنها متن</Note>);

    expect(screen.getByText("تنها متن")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("carries an action and the role it was given", () => {
    render(
      <Note type="error" role="status" action={<NoteAction>شارژ کیف پول</NoteAction>}>
        اعتبار کافی نیست
      </Note>,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "شارژ کیف پول" })).toBeInTheDocument();
  });
});
