import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { AdminApi } from "../../features/admin/adminApi";
import type { ContentEntry } from "../../runtime/contracts/content";
import { ContentSection } from "./ContentSection";

const ID = "0192f7a0-0000-7000-8000-00000000000a";
const COVER = "/api/v1/content/media/0192f7a0-0000-7000-8000-000000000001.jpg";

const effect: ContentEntry = {
  id: ID,
  kind: "preset",
  status: "published",
  item: {
    id: "p1",
    title: "نور نئون",
    familyId: "seedance",
    seed: "seed-p1",
    prompt: "neon rim light, ",
    openEnded: true,
    kind: "video",
    category: "vfx",
  },
};

function renderSection(canWrite = true) {
  const api = {
    listFamilies: vi.fn(async () => [
      { id: "seedance", name: "Seedance 2", kind: "video" as const },
      { id: "nano-banana", name: "Nano Banana", kind: "image" as const },
      { id: "suno", name: "Suno", kind: "audio" as const },
    ]),
    listContent: vi.fn(async (kind: string) => (kind === "preset" ? [effect] : [])),
    createContent: vi.fn(async () => effect),
    updateContent: vi.fn(async () => effect),
    deleteContent: vi.fn(async () => undefined),
    uploadContentMedia: vi.fn(async () => ({ url: COVER, kind: "image" as const, byteSize: 1234 })),
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ContentSection api={api as unknown as AdminApi} canWrite={canWrite} />
    </QueryClientProvider>,
  );
  return api;
}

describe("the content section", () => {
  it("adds an effect with an uploaded cover", async () => {
    const api = renderSection();
    await screen.findByText("نور نئون");

    await userEvent.click(screen.getByRole("button", { name: /افکت تازه/ }));
    await userEvent.type(screen.getByLabelText("عنوان"), "باران شبانه");
    await userEvent.type(screen.getByLabelText("پرامپت"), "rain at night, ");
    await userEvent.selectOptions(screen.getByLabelText("مدل"), "nano-banana");
    await userEvent.upload(screen.getByLabelText("تصویر کاور"), new File([new Uint8Array(10)], "cover.png", { type: "image/png" }));
    await screen.findByRole("button", { name: "برداشتن" });
    await userEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => expect(api.createContent).toHaveBeenCalled());
    expect(api.uploadContentMedia).toHaveBeenCalledWith(expect.any(File), "cover");
    expect(api.createContent).toHaveBeenCalledWith({
      kind: "preset",
      status: "published",
      item: expect.objectContaining({
        title: "باران شبانه",
        prompt: "rain at night, ",
        familyId: "nano-banana",
        kind: "image",
        coverUrl: COVER,
      }),
    });
  });

  it("offers no audio model, which cannot run an effect", async () => {
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: /افکت تازه/ }));

    await waitFor(() => expect(screen.getByRole("option", { name: /Nano Banana/ })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: /Suno/ })).not.toBeInTheDocument();
  });

  it("refuses a cover over the limit before sending a byte", async () => {
    const api = renderSection();
    await userEvent.click(await screen.findByRole("button", { name: /افکت تازه/ }));

    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText("تصویر کاور"), big);

    expect(await screen.findByRole("alert")).toHaveTextContent("سقف 5 مگابایت");
    expect(api.uploadContentMedia).not.toHaveBeenCalled();
  });

  it("edits without sending the code or the placeholder seed back", async () => {
    const api = renderSection();

    await userEvent.click(await screen.findByRole("button", { name: "ویرایش نور نئون" }));
    const title = screen.getByLabelText("عنوان");
    await userEvent.clear(title);
    await userEvent.type(title, "نور سرد");
    await userEvent.click(screen.getByRole("checkbox", { name: "روی سایت نشان داده شود" }));
    await userEvent.click(screen.getByRole("button", { name: "ذخیره" }));

    await waitFor(() => expect(api.updateContent).toHaveBeenCalled());
    const [id, write] = api.updateContent.mock.calls[0] as unknown as [string, { status: string; item: Record<string, unknown> }];
    expect(id).toBe(ID);
    expect(write.status).toBe("draft");
    expect(write.item).toMatchObject({ title: "نور سرد" });
    expect(write.item).not.toHaveProperty("id");
    expect(write.item).not.toHaveProperty("seed");
  });

  it("asks before deleting", async () => {
    const api = renderSection();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    await userEvent.click(await screen.findByRole("button", { name: "حذف نور نئون" }));
    expect(api.deleteContent).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "حذف نور نئون" }));

    await waitFor(() => expect(api.deleteContent).toHaveBeenCalledWith(ID));
    confirm.mockRestore();
  });

  it("searches the list", async () => {
    renderSection();
    await screen.findByText("نور نئون");

    await userEvent.type(screen.getByRole("searchbox"), "باران");

    expect(screen.queryByText("نور نئون")).not.toBeInTheDocument();
    expect(screen.getByText("چیزی پیدا نشد.")).toBeInTheDocument();
  });

  it("shows no way to change anything without content.write", async () => {
    renderSection(false);
    await screen.findByText("نور نئون");

    expect(screen.queryByRole("button", { name: /افکت تازه/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ویرایش/ })).not.toBeInTheDocument();
  });
});
