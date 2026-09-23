import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminApi, AdminPendingPost, AdminReportedPost } from "../../features/admin/adminApi";
import { Cell, Muted, Row, Table, when } from "./primitives";

/**
 * What customers have shared, and what other customers have complained about.
 *
 * `POST /api/v1/community` has landed shares in `pending` since the feature
 * shipped, and the three routes that move them on — approve, reject, take
 * down — have existed the whole time with no screen in front of them. A queue
 * with no consumer is a promise to the author that nothing keeps: the only way
 * to approve a share was to hand-write a request.
 *
 * Two lists, because they are two different decisions. The queue is "may this
 * be published at all", answered before anyone sees it. The reports are "a
 * published post is being complained about", answered after — and answering it
 * either way (taking the post down, or marking the reports looked at) is what
 * stops the list growing forever and being ignored.
 */
export function CommunitySection({ api, canWrite }: { api: AdminApi; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const pending = useQuery({ queryKey: ["admin", "community", "pending"], queryFn: () => api.listPendingPosts(), retry: false });
  const reported = useQuery({ queryKey: ["admin", "community", "reports"], queryFn: () => api.listReportedPosts(), retry: false });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin", "community"] });
  };

  const decide = useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: "approve" | "reject"; reason?: string }) =>
      api.decidePost(id, decision, reason),
    onSuccess: refresh,
  });
  const resolve = useMutation({ mutationFn: (id: string) => api.resolveReports(id), onSuccess: refresh });
  const takeDown = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.takeDownPost(id, reason),
    onSuccess: refresh,
  });

  return (
    <div>
      <section>
        <h2 className="text-[14px] font-bold" style={{ color: "var(--vg-text)" }}>
          در انتظار تأیید
        </h2>
        <p className="mt-1 text-[12px] leading-6" style={{ color: "var(--vg-text-faint)" }}>
          تا وقتی تأیید نشوند هیچ‌کس جز خود سازنده آن‌ها را نمی‌بیند. تأیید یعنی این تصویر و پرامپتش برای همه‌ی بازدیدکننده‌های سایت دیده
          می‌شود.
        </p>

        {pending.isPending ? <Muted>در حال خواندن…</Muted> : null}
        {pending.error ? <Muted>صف خوانده نشد.</Muted> : null}
        {pending.data?.length === 0 ? <Muted>چیزی در صف نیست.</Muted> : null}
        {decide.error ? <Muted>ثبت نشد؛ صف را دوباره بخوان.</Muted> : null}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(pending.data ?? []).map((post) => (
            <PendingCard
              key={post.id}
              post={post}
              canWrite={canWrite}
              busy={decide.isPending}
              onDecide={(decision, reason) => decide.mutate({ id: post.id, decision, ...(reason ? { reason } : {}) })}
            />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-[14px] font-bold" style={{ color: "var(--vg-text)" }}>
          گزارش‌شده‌ها
        </h2>
        <p className="mt-1 text-[12px] leading-6" style={{ color: "var(--vg-text-faint)" }}>
          پستی که منتشر شده و کسی به آن اعتراض کرده، پرگزارش‌ترین اول. «رسیدگی شد» گزارش‌ها را می‌بندد و پست سر جایش می‌ماند؛ «حذف از سایت»
          آن را برمی‌دارد و دلیلش ثبت می‌شود.
        </p>

        {reported.isPending ? <Muted>در حال خواندن…</Muted> : null}
        {reported.error ? <Muted>گزارش‌ها خوانده نشدند.</Muted> : null}
        {reported.data?.length === 0 ? <Muted>گزارش بازی نیست.</Muted> : null}
        {takeDown.error || resolve.error ? <Muted>انجام نشد؛ دوباره تلاش کن.</Muted> : null}

        {reported.data && reported.data.length > 0 ? (
          <Table head={["پست", "سازنده", "گزارش‌ها", "دسته‌ها", "اولین گزارش", ""]}>
            {reported.data.map((post) => (
              <ReportedRow
                key={post.postId}
                post={post}
                canWrite={canWrite}
                busy={takeDown.isPending || resolve.isPending}
                onResolve={() => resolve.mutate(post.postId)}
                onTakeDown={(reason) => takeDown.mutate({ id: post.postId, reason })}
              />
            ))}
          </Table>
        ) : null}
      </section>
    </div>
  );
}

function PendingCard({
  post,
  canWrite,
  busy,
  onDecide,
}: {
  post: AdminPendingPost;
  canWrite: boolean;
  busy: boolean;
  onDecide: (decision: "approve" | "reject", reason?: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="flex flex-col rounded-xl p-3" style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}>
      {post.previewUrl ? (
        post.previewKind === "video" ? (
          <video src={post.previewUrl} controls preload="metadata" className="mb-2 aspect-video w-full rounded-lg bg-black" />
        ) : (
          <img
            src={post.previewUrl}
            alt=""
            className="mb-2 max-h-[280px] w-full rounded-lg object-contain"
            style={{ background: "black" }}
          />
        )
      ) : (
        <p
          className="mb-2 rounded-lg px-2 py-3 text-center text-[11.5px]"
          style={{ background: "var(--vg-canvas)", color: "var(--vg-text-faint)" }}
        >
          فایلی برای این پست نمانده — فقط بر اساس متن تصمیم بگیر.
        </p>
      )}

      <div className="flex flex-wrap items-baseline gap-x-2 text-[11.5px]" style={{ color: "var(--vg-text-faint)" }}>
        <span dir="ltr" style={{ color: "var(--vg-text)" }}>
          {post.author}
        </span>
        <span dir="ltr">{post.familyId}</span>
        <span>{when(post.submittedAt)}</span>
        {/* Whether the recipe goes out with it. A moderator sees the prompt either way. */}
        <span>{post.promptVisible ? "پرامپت دیده می‌شود" : "پرامپت پنهان است"}</span>
      </div>

      {post.caption ? (
        <p className="mt-1.5 text-[12.5px] leading-6" style={{ color: "var(--vg-text)" }}>
          {post.caption}
        </p>
      ) : null}
      <p
        className="ltr mt-1.5 rounded-lg px-2 py-1.5 text-[11.5px] leading-5"
        style={{ background: "var(--vg-canvas)", color: "var(--vg-text-secondary)" }}
      >
        {post.prompt || "—"}
      </p>

      {canWrite ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="دلیل رد (اختیاری)"
            aria-label={`دلیل رد ${post.author}`}
            maxLength={280}
            className="h-8 min-w-[140px] flex-1 rounded-lg px-2 text-[12px]"
            style={{ background: "var(--vg-canvas)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide("reject", reason.trim() || undefined)}
            className="h-8 rounded-lg px-3 text-[12px] disabled:opacity-50"
            style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-danger, #ff6c52)" }}
          >
            رد
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide("approve")}
            className="h-8 rounded-lg px-3 text-[12px] font-bold disabled:opacity-50"
            style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
          >
            تأیید
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ReportedRow({
  post,
  canWrite,
  busy,
  onResolve,
  onTakeDown,
}: {
  post: AdminReportedPost;
  canWrite: boolean;
  busy: boolean;
  onResolve: () => void;
  onTakeDown: (reason: string) => void;
}) {
  return (
    <Row>
      <Cell>
        <span className="block max-w-[260px] truncate">{post.caption || "—"}</span>
        <span className="ltr block max-w-[260px] truncate text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
          {post.prompt}
        </span>
      </Cell>
      <Cell dim>
        <span dir="ltr">{post.author}</span>
      </Cell>
      <Cell>{post.reports}</Cell>
      <Cell dim>{post.categories.join("، ") || "—"}</Cell>
      <Cell dim>{when(post.firstReportedAt)}</Cell>
      <Cell>
        {canWrite ? (
          <span className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={onResolve}
              className="h-7 rounded-lg px-2 text-[11.5px] disabled:opacity-50"
              style={{ background: "var(--vg-surface)", color: "var(--vg-text-muted)", border: "1px solid var(--vg-border-subtle)" }}
            >
              رسیدگی شد
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                // A takedown's reason is required by the route, and this is the
                // one action here somebody may have to justify months later.
                const reason = window.prompt("دلیل حذف؟ (ثبت می‌شود)");
                if (reason && reason.trim().length >= 3) onTakeDown(reason.trim());
              }}
              className="h-7 rounded-lg px-2 text-[11.5px] disabled:opacity-50"
              style={{ background: "var(--vg-surface)", color: "var(--vg-danger, #ff6c52)", border: "1px solid var(--vg-border-subtle)" }}
            >
              حذف از سایت
            </button>
          </span>
        ) : null}
      </Cell>
    </Row>
  );
}
