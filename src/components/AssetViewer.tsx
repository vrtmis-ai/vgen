import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFamily } from "../features/catalog/CatalogProvider";
import {
  X,
  Info,
  PencilSimple,
  ChatCircle,
  Copy,
  CaretDown,
  CaretLeft,
  CaretUp,
  DownloadSimple,
  VideoCamera,
  ArrowsClockwise,
  Image as ImageIcon,
  ArrowsOut,
  MagicWand,
  Selection,
  Sun,
  FrameCorners,
} from "@phosphor-icons/react";
import { displayAspect, type Generation } from "../lib/gallery";
import { useI18n } from "../lib/i18n";
import { useModalSurface } from "./FloatingSurface";

/* ---------------------------------------------------------------------------
   The asset viewer — the reference's image detail overlay.

   Nothing like this existed here: a generated image could be looked at and
   nothing else. No download, no enlarge, no upscale, no "use as reference". The
   thing the user paid for was a dead tile.

   Their layout, measured: the image centred on a dimmed backdrop with two ghost
   controls at its bottom corner, and a ~285px panel pinned to the trailing edge
   holding three tabs — Info, Tools, Comments — over a stack of actions pinned
   to the panel floor:

       [ Turn to video ]          full width, accent
       [ Recreate ][ Reference ]  two up, neutral
       [ Download ][♡][↗][⋯]      wide + three squares

   The order is a claim about what people do with a finished image, and it is
   worth keeping: extend it into another medium, make another like it, use it as
   input, then take it away.

   Tools rows map onto real families in our catalog. Where we have no model for
   a row it stays visible and disabled with the reason on it, per the system's
   rule about unavailable models — hiding it would make the gap invisible to us
   as well as to the user.
   --------------------------------------------------------------------------- */

export interface ViewerAsset {
  id: string;
  /**
   * The job that produced it, when one did.
   *
   * Absent on a demo generation, which has no server behind it. Present is what
   * lets the download button go through the API for a link that saves rather
   * than one the browser opens in a tab.
   */
  jobId?: string | undefined;
  url: string;
  prompt: string;
  familyId: string;
  w: number;
  h: number;
  createdAt?: number | undefined;
  author?: string | undefined;
}

/**
 * A finished generation, as the viewer wants it.
 *
 * Here rather than in each screen because both the studio wall and كارهای من
 * open the same panel over the same rows, and the two had drifted: the studio
 * corrected the frame to the size that actually came back while the gallery
 * still used the size that was asked for.
 */
export function viewerAsset(gen: Generation, placeholderUrl?: string): ViewerAsset {
  // What arrived, not what was ordered. A 9:16 request answered at 768x1344
  // laid out a hair short of its own picture when this was read from w/h.
  const shape = displayAspect(gen);
  return {
    id: gen.id,
    ...(gen.jobId ? { jobId: gen.jobId } : {}),
    url: gen.outputUrl ?? placeholderUrl ?? "",
    prompt: gen.prompt,
    familyId: gen.familyId,
    w: shape.w,
    h: shape.h,
    createdAt: gen.createdAt,
  };
}

/**
 * Save the file, rather than open it in a tab.
 *
 * Through the API and not straight at the object: `download` on an anchor is
 * honoured only for same-origin URLs, and an output URL is signed against the
 * store's host — so the attribute was ignored and the browser did the other
 * thing it knows how to do with a picture. The route answers 302 to the same
 * object signed to arrive as an attachment, named from the stored mime type.
 *
 * A demo generation has no job behind it and its URL is already local to the
 * page, so there the attribute works and is all there is.
 */
export function downloadAsset(downloadUrl: (jobId: string) => string, asset: ViewerAsset): void {
  const el = document.createElement("a");
  if (asset.jobId) el.href = downloadUrl(asset.jobId);
  else {
    el.href = asset.url;
    el.download = `vgen-${asset.id}.jpg`;
  }
  el.rel = "noopener";
  el.click();
}

type Tab = "info" | "tools" | "comments";

/** A Tools row. `familyId` present = we can actually run it. */
const TOOLS: { key: string; label: string; Icon: typeof MagicWand; familyId?: string; badge?: string }[] = [
  { key: "upscale", label: "بزرگ‌نمایی", Icon: ArrowsOut, familyId: "topaz" },
  { key: "removebg", label: "حذف پس‌زمینه", Icon: Selection, familyId: "recraft" },
  { key: "edit", label: "ویرایش با دستور متنی", Icon: MagicWand, familyId: "nano-banana" },
  { key: "relight", label: "نورپردازی دوباره", Icon: Sun },
  { key: "angles", label: "زاویه‌های دیگر", Icon: FrameCorners },
];

function Row({
  label,
  Icon,
  badge,
  disabled,
  reason,
  onClick,
}: {
  label: string;
  Icon: typeof MagicWand;
  badge?: string | undefined;
  disabled?: boolean;
  reason?: string;
  // `| undefined` is not redundant under exactOptionalPropertyTypes: a row for a
  // model we do not have passes the key holding undefined, which is a different
  // thing from omitting it.
  onClick?: (() => void) | undefined;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? reason : undefined}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-start transition-colors hover:bg-white/5 disabled:pointer-events-none"
    >
      <Icon size={16} style={{ color: disabled ? "var(--vg-text-faint)" : "var(--vg-primary-soft)" }} />
      <span className="flex-1 text-[13px]" style={{ color: disabled ? "var(--vg-text-faint)" : "var(--vg-text)" }}>
        {label}
        {disabled && (
          <span className="ms-1.5 text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
            — {reason}
          </span>
        )}
      </span>
      {badge && (
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold"
          style={{ background: "var(--vg-primary-a18)", color: "var(--vg-primary-soft)" }}
        >
          {badge}
        </span>
      )}
      {!disabled && <CaretLeft size={12} weight="bold" style={{ color: "var(--vg-text-faint)" }} />}
    </button>
  );
}

export function AssetViewer({
  asset,
  onClose,
  onOpenModel,
  onRegenerate,
  onDownload,
}: {
  asset: ViewerAsset;
  onClose: () => void;
  /**
   * Open a model, optionally carrying this asset in as its *input*.
   *
   * The third argument is what "to video" and "use as reference" mean: the
   * picture on screen becomes the next generation's opening frame. Both used to
   * omit it and open an empty form — the button named the model and dropped the
   * only thing the user had pressed it on.
   */
  onOpenModel: (familyId: string, prompt?: string, fromGenerationId?: string) => void;
  /**
   * Run this generation again as it was run — its own model, settings and
   * input files, not this output fed back in. The opposite direction to the
   * third argument above, which is why it is a separate handler rather than
   * another call to the same one.
   */
  onRegenerate: (a: ViewerAsset) => void;
  onDownload: (a: ViewerAsset) => void;
}) {
  const { n } = useI18n();
  const [tab, setTab] = useState<Tab>("info");
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const family = useFamily(asset.familyId);

  // Escape closes. Without it the only way out is the ×, and a full-screen
  // overlay that traps the keyboard is the classic lightbox complaint.
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalSurface({ surfaceRef: dialogRef, onClose, initialFocusRef: closeRef });

  const copyPrompt = () => {
    void navigator.clipboard?.writeText(asset.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const created = asset.createdAt
    ? new Intl.DateTimeFormat("fa-IR", { year: "numeric", month: "long", day: "numeric" }).format(asset.createdAt)
    : "—";

  /* Portalled to <body>, and that is load-bearing rather than tidiness.

     useModalSurface marks every *direct child of body* except the modal root
     inert, so the rest of the page cannot be clicked or tabbed into while a
     dialog is open. It finds that root with closest("[data-modal-root]"), and
     rendered inline this element is not a child of body at all — so the filter
     matched nothing, every child of body was marked inert including the one
     containing this dialog, and inert inherits. The whole panel went dead:
     tabs, download, and the close button with it. Escape still worked, because
     that listener is on the document, which is the shape the bug reported as
     "none of the buttons do anything".

     Every other dialog here (PresetPicker, VoicePicker, ModelPicker) already
     portals for this reason. This one was the exception. */
  return createPortal(
    <div
      ref={dialogRef}
      data-modal-root
      role="dialog"
      aria-modal="true"
      aria-label="نمایش دارایی"
      tabIndex={-1}
      className="fixed inset-0 z-[70] flex"
      style={{ background: "rgba(9,9,9,0.94)" }}
    >
      <div className="relative flex min-w-0 flex-1 items-center justify-center p-6">
        <img
          src={asset.url}
          alt={asset.prompt}
          className="max-h-full rounded-xl object-contain"
          style={{ maxWidth: full ? "100%" : "min(100%, 46vh * var(--ar, 1))", aspectRatio: `${asset.w} / ${asset.h}` }}
        />
        <div className="absolute bottom-6 flex gap-1.5" style={{ insetInlineEnd: "1.5rem" }}>
          <button
            onClick={() => setFull((v) => !v)}
            aria-label={full ? "کوچک کن" : "بزرگ کن"}
            className="grid size-9 place-items-center rounded-lg"
            style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-secondary)" }}
          >
            {full ? <CaretDown size={16} /> : <ArrowsOut size={16} />}
          </button>
        </div>
      </div>

      <aside
        className="flex w-full max-w-[320px] shrink-0 flex-col"
        style={{ background: "var(--vg-surface)", borderInlineStart: "1px solid var(--vg-border-subtle)" }}
      >
        <div className="flex items-center gap-2.5 p-3.5">
          <span
            className="grid size-8 place-items-center rounded-full text-[11px] font-bold"
            style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
          >
            {(asset.author ?? "من").slice(0, 2)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold" style={{ color: "var(--vg-text)" }}>
              {asset.author ?? "ساختهٔ تو"}
            </p>
            <p className="text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
              سازنده
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="بستن"
            className="grid size-8 place-items-center rounded-lg"
            style={{ color: "var(--vg-text-muted)" }}
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="mx-3 flex gap-1 rounded-xl p-1" style={{ background: "var(--vg-canvas)" }}>
          {(
            [
              ["info", "اطلاعات", Info],
              ["tools", "ابزارها", PencilSimple],
              ["comments", "نظرها", ChatCircle],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-semibold transition-colors"
              style={{
                background: tab === k ? "var(--vg-surface-overlay)" : "transparent",
                color: tab === k ? "var(--vg-text)" : "var(--vg-text-muted)",
              }}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
          {tab === "info" && (
            <>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold tracking-wide" style={{ color: "var(--vg-text-faint)" }}>
                  پرامپت
                </span>
                <button
                  onClick={copyPrompt}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]"
                  style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
                >
                  <Copy size={11} />
                  {copied ? "کپی شد" : "کپی"}
                </button>
              </div>
              <p className="ltr line-clamp-6 text-[12.5px] leading-6" style={{ color: "var(--vg-text-secondary)" }}>
                {asset.prompt}
              </p>

              <div className="mb-1.5 mt-5 flex items-center justify-between">
                <span className="text-[11px] font-semibold tracking-wide" style={{ color: "var(--vg-text-faint)" }}>
                  جزئیات
                </span>
                <CaretUp size={12} style={{ color: "var(--vg-text-faint)" }} />
              </div>
              <dl className="rounded-xl px-3 py-1" style={{ background: "var(--vg-canvas)" }}>
                {[
                  ["مدل", family?.name ?? asset.familyId],
                  ["سازنده", family?.vendor ?? "—"],
                  ["ابعاد", `${asset.w}×${asset.h}`],
                  ["ساخته‌شده", created],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between border-b py-2 last:border-0"
                    style={{ borderColor: "var(--vg-border-subtle)" }}
                  >
                    <dt className="text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
                      {k}
                    </dt>
                    <dd className="vg-numeric text-[12px]" style={{ color: "var(--vg-text)" }}>
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {tab === "tools" && (
            <>
              <p className="mb-1 px-1 text-[11px] font-semibold tracking-wide" style={{ color: "var(--vg-text-faint)" }}>
                ویرایش تصویر
              </p>
              {TOOLS.map((t) => (
                <Row
                  key={t.key}
                  label={t.label}
                  Icon={t.Icon}
                  badge={t.badge}
                  disabled={!t.familyId}
                  reason="مدلش را هنوز نداریم"
                  onClick={t.familyId ? () => onOpenModel(t.familyId!) : undefined}
                />
              ))}
            </>
          )}

          {tab === "comments" && (
            <p className="px-1 pt-4 text-[12.5px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
              نظرها وقتی معنی دارند که کار عمومی شده باشد. این هنوز فقط مال توست.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 p-3" style={{ borderBlockStart: "1px solid var(--vg-border-subtle)" }}>
          <button
            onClick={() => onOpenModel("seedance", asset.prompt, asset.id)}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-bold"
            style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
          >
            <VideoCamera size={16} weight="fill" />
            تبدیل به ویدیو
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onRegenerate(asset)}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl text-[12.5px] font-semibold"
              style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
            >
              <ArrowsClockwise size={14} />
              دوباره بساز
            </button>
            <button
              onClick={() => onOpenModel(asset.familyId, undefined, asset.id)}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl text-[12.5px] font-semibold"
              style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
            >
              <ImageIcon size={14} />
              به‌عنوان مرجع
            </button>
          </div>
          {/* Download alone on its row. It shared it with a heart, a share and
              an overflow that were markup only — no handler, no menu, and
              nothing behind them: liking does not exist, and community sharing
              has a server route but no way for a browser to call it. A control
              that cannot act is worse than an absent one, so they are gone
              until there is something for them to do. */}
          <button
            onClick={() => onDownload(asset)}
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-[12.5px] font-semibold"
            style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
          >
            <DownloadSimple size={14} />
            دانلود
          </button>
          <p className="text-center text-[10.5px]" style={{ color: "var(--vg-text-faint)" }}>
            {n(asset.w * asset.h > 4_000_000 ? 4 : 2)}K · بدون واترمارک
          </p>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
