import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRevealArrival } from "./useRevealArrival";

/* ---------------------------------------------------------------------------
   A page that scrolls by itself.

   The studios bring a new job into view because the press no longer leaves the
   page. The same list also changes for reasons nobody pressed for — the history
   arriving from the server, a job started in another tab — and a canvas that
   jumped for those would be the new bug. So: only after `arm()`, and only once.
   --------------------------------------------------------------------------- */

function Canvas({ ids }: { ids: string[] }) {
  const reveal = useRevealArrival(ids[0]);
  return (
    <>
      {/* The press: the studios arm at the moment «بساز» sends the job. */}
      <button onClick={reveal.arm}>بساز</button>
      <ul>
        {ids.map((id) => (
          <li key={id} data-id={id} ref={id === ids[0] ? reveal.target : undefined} />
        ))}
      </ul>
    </>
  );
}

const press = () => fireEvent.click(screen.getByRole("button", { name: "بساز" }));

describe("bringing a new generation into view", () => {
  const scrolled: string[] = [];

  beforeEach(() => {
    scrolled.length = 0;
    // jsdom has no scrollIntoView; record which element was asked instead.
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value(this: Element) {
        scrolled.push(this.getAttribute("data-id") ?? "?");
      },
    });
  });
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    vi.useRealTimers();
  });

  it("leaves the page alone when something arrives that nobody pressed for", () => {
    const { rerender } = render(<Canvas ids={["a"]} />);

    rerender(<Canvas ids={["b", "a"]} />);

    expect(scrolled).toEqual([]);
  });

  it("scrolls to the job a press made, once", () => {
    const { rerender } = render(<Canvas ids={["a"]} />);

    press();
    rerender(<Canvas ids={["b", "a"]} />);
    rerender(<Canvas ids={["c", "b", "a"]} />);

    expect(scrolled).toEqual(["b"]);
  });

  it("forgets a press that never produced a job", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Canvas ids={["a"]} />);

    press();
    // A refused submission adds nothing. A minute later, an unrelated arrival.
    vi.advanceTimersByTime(61_000);
    rerender(<Canvas ids={["b", "a"]} />);

    expect(scrolled).toEqual([]);
  });
});
