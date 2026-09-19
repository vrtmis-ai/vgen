import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RefSlot } from "../data/models";
import type { RefMap } from "./controls";
import { RefBox } from "./RefBox";

/* ---------------------------------------------------------------------------
   Which part of the clip a picture is.

   It is the one question about a reference that the file cannot answer for
   itself — `kindOfFile` reads picture-or-clip off the MIME type, but nothing in
   a PNG says "this is the last frame". The box used to ask it with a labelled
   upload area per slot; one box replaced those, and the answer moved into a
   «…» menu on a 72px thumbnail, where it stopped being found.

   So the badge is the control. These are the two presses that matter: a frame
   swapping to the other end, and a plain reference being made a frame.
   --------------------------------------------------------------------------- */

const FRAME_SLOTS: RefSlot[] = [
  { key: "first_frame_url", group: "frame", label: "فریم شروع (اختیاری)", max: 1 },
  { key: "last_frame_url", group: "frame", label: "فریم پایان (اختیاری)", max: 1 },
];

const MIXED_SLOTS: RefSlot[] = [
  { key: "reference_image", label: "تصاویر مرجع (الزامی)", max: 5, required: true },
  { key: "first_frame_url", group: "frame", label: "فریم شروع (اختیاری)", max: 1 },
];

function picture(): RefMap[string][number] {
  return { file: new File(["x"], "frame.png", { type: "image/png" }), url: "blob:frame" };
}

function show(slots: RefSlot[], refs: RefMap) {
  const onChange = vi.fn();
  render(<RefBox slots={slots} refs={refs} onChange={onChange} prompt="" onInsertTag={vi.fn()} />);
  return onChange;
}

describe("the part a reference plays", () => {
  it("swaps a start frame for an end frame from the badge itself", async () => {
    const onChange = show(FRAME_SLOTS, { first_frame_url: [picture()] });

    await userEvent.click(screen.getByRole("button", { name: /بخش این فایل: فریم شروع/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as RefMap;
    expect(next["last_frame_url"]).toHaveLength(1);
    expect(next["first_frame_url"] ?? []).toHaveLength(0);
  });

  it("offers a plain reference the way to become the opening frame", async () => {
    const onChange = show(MIXED_SLOTS, { reference_image: [picture()] });

    await userEvent.click(screen.getByRole("button", { name: /بخش این فایل: مرجع/ }));

    const next = onChange.mock.calls[0]?.[0] as RefMap;
    expect(next["first_frame_url"]).toHaveLength(1);
  });

  it("says nothing about parts on a model that has only one", async () => {
    show([{ key: "reference_image_urls", label: "تصاویر مرجع (اختیاری)", max: 9 }], { reference_image_urls: [picture()] });

    // Seedance's shape: one image slot, so there is no part to choose and no
    // control that pretends otherwise.
    expect(screen.queryByRole("button", { name: /بخش این فایل/ })).toBeNull();
  });
});
