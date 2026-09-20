import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { promptCap, useAutoGrow } from "./useAutoGrow";

/* ---------------------------------------------------------------------------
   A prompt box that can be read back.

   Every dock capped its prompt at a fixed `rows` — two in the image dock —
   with `resize-none` and a hidden scrollbar, so past that the sentence simply
   left: nothing on screen said it continued and nothing could be dragged to
   see it. jsdom lays nothing out, so `scrollHeight` is 0 here; what these
   assert is the arithmetic around it, which is where the rules live.
   --------------------------------------------------------------------------- */

describe("how tall a prompt box may get", () => {
  it("collapses to five lines, whatever the line height is", () => {
    expect(promptCap(false, 24)).toBe(5 * 24 + 12);
    expect(promptCap(false, 21)).toBe(5 * 21 + 12);
  });

  it("opens to half the window, and never to less than a readable box", () => {
    expect(promptCap(true, 24)).toBe(Math.max(240, Math.round(window.innerHeight * 0.5)));
    expect(promptCap(true, 24)).toBeGreaterThanOrEqual(240);
  });

  /* The cap is the only thing between the two states, so a caller flipping it
     is the whole of "expand". */
  it("opens taller than it collapses", () => {
    expect(promptCap(true, 24)).toBeGreaterThan(promptCap(false, 24));
  });
});

function Box() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const wants = useAutoGrow(ref, value, promptCap(false, 24));
  return (
    <>
      <textarea ref={ref} value={value} onChange={(event) => setValue(event.target.value)} aria-label="prompt" />
      <output data-testid="wants">{wants}</output>
    </>
  );
}

describe("the box measures itself", () => {
  it("sets a height rather than leaving the browser's own", () => {
    render(<Box />);
    const box = screen.getByLabelText("prompt");

    fireEvent.change(box, { target: { value: "a small red boat" } });

    // jsdom reports 0 for every layout read, so the height lands at 0px — the
    // claim worth holding here is that the hook writes one at all, and that it
    // reports back what the content asked for.
    expect(box.style.height).not.toBe("");
    expect(screen.getByTestId("wants")).toHaveTextContent("0");
  });
});
