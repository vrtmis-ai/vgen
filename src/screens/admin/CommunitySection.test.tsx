import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { AdminApi, AdminPendingPost, AdminReportedPost } from "../../features/admin/adminApi";
import { CommunitySection } from "./CommunitySection";

/* ---------------------------------------------------------------------------
   The moderation queue, which had routes and no screen until now.

   The two decisions are different and the tests follow that split: a share is
   approved or rejected before anyone sees it, and a published post that is
   being complained about is either taken down with a recorded reason or its
   reports are marked looked at.
   --------------------------------------------------------------------------- */

const waiting: AdminPendingPost = {
  id: "0192f7a0-0000-7000-8000-00000000000c",
  author: "@narges",
  kind: "image",
  familyId: "seedream",
  caption: "غروب تهران",
  prompt: "tehran skyline at golden hour",
  promptVisible: true,
  submittedAt: Date.now() - 3_600_000,
  previewUrl: "https://files.example/uploads/a.png?sig=1",
  previewKind: "image",
};

const complained: AdminReportedPost = {
  postId: "0192f7a0-0000-7000-8000-00000000000d",
  caption: "پرتره",
  prompt: "portrait, studio light",
  author: "@sina",
  reports: 3,
  categories: ["nudity", "other"],
  firstReportedAt: Date.now() - 86_400_000,
};

function renderSection(canWrite = true, pending: AdminPendingPost[] = [waiting], reported: AdminReportedPost[] = [complained]) {
  const api = {
    listPendingPosts: vi.fn(async () => pending),
    decidePost: vi.fn(async () => undefined),
    listReportedPosts: vi.fn(async () => reported),
    resolveReports: vi.fn(async () => 3),
    takeDownPost: vi.fn(async () => undefined),
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CommunitySection api={api as unknown as AdminApi} canWrite={canWrite} />
    </QueryClientProvider>,
  );
  return api;
}

describe("the moderation queue", () => {
  it("shows the file being judged, not just its words", async () => {
    renderSection();

    await waitFor(() => expect(document.querySelector(`img[src="${waiting.previewUrl}"]`)).not.toBeNull());
    expect(screen.getByText("غروب تهران")).toBeInTheDocument();
    expect(screen.getByText("tehran skyline at golden hour")).toBeInTheDocument();
  });

  it("says so rather than showing nothing when the file is gone", async () => {
    const { previewUrl: _url, previewKind: _kind, ...noFile } = waiting;
    renderSection(true, [noFile]);

    expect(await screen.findByText(/فایلی برای این پست نمانده/)).toBeInTheDocument();
  });

  it("approves without a reason and rejects with the one that was typed", async () => {
    const api = renderSection();
    await screen.findByText("غروب تهران");

    await userEvent.click(screen.getByRole("button", { name: "تأیید" }));
    await waitFor(() => expect(api.decidePost).toHaveBeenCalledWith(waiting.id, "approve", undefined));

    await userEvent.type(screen.getByLabelText("دلیل رد @narges"), "خارج از قوانین");
    await userEvent.click(screen.getByRole("button", { name: "رد" }));

    await waitFor(() => expect(api.decidePost).toHaveBeenLastCalledWith(waiting.id, "reject", "خارج از قوانین"));
  });

  it("takes a post down only with a reason, and resolves reports without one", async () => {
    const api = renderSection();
    await screen.findByText("پرتره");

    const prompt = vi.spyOn(window, "prompt").mockReturnValueOnce(null).mockReturnValueOnce("درخواست حقوقی");
    await userEvent.click(screen.getByRole("button", { name: "حذف از سایت" }));
    expect(api.takeDownPost).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "حذف از سایت" }));
    await waitFor(() => expect(api.takeDownPost).toHaveBeenCalledWith(complained.postId, "درخواست حقوقی"));

    await userEvent.click(screen.getByRole("button", { name: "رسیدگی شد" }));
    await waitFor(() => expect(api.resolveReports).toHaveBeenCalledWith(complained.postId));
    prompt.mockRestore();
  });

  it("offers no decision at all to somebody who may only read", async () => {
    renderSection(false);
    await screen.findByText("غروب تهران");

    expect(screen.queryByRole("button", { name: "تأیید" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "حذف از سایت" })).not.toBeInTheDocument();
  });

  it("says the queue is empty rather than drawing nothing", async () => {
    renderSection(true, [], []);

    expect(await screen.findByText("چیزی در صف نیست.")).toBeInTheDocument();
  });
});
