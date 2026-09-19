import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RefSlot } from "../data/models";
import type { RefMap } from "./controls";
import { RefBox } from "./RefBox";

/* ---------------------------------------------------------------------------
   Where the opening frame goes.

   One box takes anything and routes it by MIME type, which is right for a bag
   of references — nine pictures of one subject, and which goes where is not a
   question anybody is asking. It is wrong for a model whose inputs are named
   roles. On Wan 2.7 the whole request is "this picture first, that one last",
   and a single box asking for "a file" cannot be answered: there is nowhere to
   put the first frame, and the only route to the word «پایان» was a menu on a
   72px thumbnail.

   So frames get their own labelled boxes, and these are the claims: the boxes
   exist and are named, a file dropped on one lands in that slot and not
   wherever the router would have chosen, and a model with a bag and nothing
   else is left exactly as it was.
   --------------------------------------------------------------------------- */

const FRAME_SLOTS: RefSlot[] = [
  { key: "first_frame_url", group: "frame", label: "فریم شروع (اختیاری)", max: 1 },
  { key: "last_frame_url", group: "frame", label: "فریم پایان (اختیاری)", max: 1 },
];

const MIXED_SLOTS: RefSlot[] = [
  { key: "reference_image", label: "تصاویر مرجع (الزامی)", max: 5, required: true },
  { key: "first_frame_url", group: "frame", label: "فریم شروع (اختیاری)", max: 1 },
];

const BAG_SLOTS: RefSlot[] = [{ key: "reference_image_urls", label: "تصاویر مرجع (اختیاری)", max: 9 }];

function picture(name = "frame.png"): RefMap[string][number] {
  return { file: new File(["x"], name, { type: "image/png" }), url: `blob:${name}` };
}

function show(slots: RefSlot[], refs: RefMap = {}) {
  const onChange = vi.fn();
  render(<RefBox slots={slots} refs={refs} onChange={onChange} prompt="" onInsertTag={vi.fn()} />);
  return onChange;
}

describe("a model whose inputs are named frames", () => {
  it("draws a box per frame, with the frame's name on it", () => {
    show(FRAME_SLOTS);

    expect(screen.getByText("فریم شروع")).toBeInTheDocument();
    expect(screen.getByText("فریم پایان")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "افزودن فریم شروع" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "افزودن فریم پایان" })).toBeInTheDocument();
    // Nothing is left for the catch-all box to hold, so it is not drawn.
    expect(screen.queryByRole("button", { name: /فایل بینداز/ })).toBeNull();
  });

  it("puts a file dropped on a named box in that slot", async () => {
    const onChange = show(FRAME_SLOTS);
    const file = new File(["x"], "end.png", { type: "image/png" });

    const target = screen.getByRole("button", { name: "افزودن فریم پایان" }).parentElement!;
    fireEvent.drop(target, { dataTransfer: { files: [file], types: ["Files"], getData: () => "" } });

    // The router would have chosen the start frame, which is the first slot
    // with room. The aim is the whole point of drawing the boxes apart.
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)?.[0] as RefMap;
    expect(next["last_frame_url"]).toHaveLength(1);
    expect(next["first_frame_url"] ?? []).toHaveLength(0);
  });

  it("trades two frames when one is dragged onto the other", () => {
    const onChange = show(FRAME_SLOTS, { first_frame_url: [picture("a.png")], last_frame_url: [picture("b.png")] });

    const boxes = screen.getAllByLabelText(/حذف فریم/).map((button) => button.parentElement!);
    fireEvent.drop(boxes[1]!, { dataTransfer: { types: ["application/x-deev-ref"], getData: () => "slot:first_frame_url" } });

    const next = onChange.mock.calls[0]?.[0] as RefMap;
    expect(next["first_frame_url"]?.[0]?.file.name).toBe("b.png");
    expect(next["last_frame_url"]?.[0]?.file.name).toBe("a.png");
  });
});

describe("a model with a bag as well", () => {
  it("keeps the one box for the references and names the frame beside it", () => {
    show(MIXED_SLOTS, { reference_image: [picture()] });

    expect(screen.getByRole("button", { name: "افزودن فریم شروع" })).toBeInTheDocument();
    // The reference still wears the part control that makes it the opening frame.
    expect(screen.getByRole("button", { name: /بخش این فایل: مرجع/ })).toBeInTheDocument();
  });

  it("offers a plain reference the way to become the opening frame", async () => {
    const onChange = show(MIXED_SLOTS, { reference_image: [picture()] });

    await userEvent.click(screen.getByRole("button", { name: /بخش این فایل: مرجع/ }));

    const next = onChange.mock.calls[0]?.[0] as RefMap;
    expect(next["first_frame_url"]).toHaveLength(1);
  });
});

describe("a model with nothing but a bag", () => {
  it("is left as it was: one box, no parts, no named slots", () => {
    show(BAG_SLOTS, { reference_image_urls: [picture()] });

    expect(screen.queryByRole("button", { name: /افزودن فریم/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /بخش این فایل/ })).toBeNull();
  });
});
