import { AnimatePresence, motion } from "framer-motion";
import { ImageSquare, VideoCamera, MagicWand, SquaresFour } from "@phosphor-icons/react";
import { spring } from "../lib/motion";
import { useI18n } from "../lib/i18n";

type Item = { icon: React.ReactNode; label: string; desc: string; onClick: () => void };

export function CreateSheet({
  open,
  onClose,
  onImage,
  onVideo,
  onTemplate,
  onAll,
}: {
  open: boolean;
  onClose: () => void;
  onImage: () => void;
  onVideo: () => void;
  onTemplate: () => void;
  onAll: () => void;
}) {
  const { t } = useI18n();
  const pick = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const items: Item[] = [
    { icon: <ImageSquare size={24} weight="fill" />, label: t("sheet_image"), desc: t("sheet_image_d"), onClick: pick(onImage) },
    { icon: <VideoCamera size={24} weight="fill" />, label: t("sheet_video"), desc: t("sheet_video_d"), onClick: pick(onVideo) },
    { icon: <MagicWand size={24} weight="fill" />, label: t("sheet_tpl"), desc: t("sheet_tpl_d"), onClick: pick(onTemplate) },
    { icon: <SquaresFour size={24} weight="fill" />, label: t("sheet_all"), desc: t("sheet_all_d"), onClick: pick(onAll) },
  ];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[480px] rounded-t-[1.75rem] border-t border-line bg-elev3 px-4 pb-[max(22px,env(safe-area-inset-bottom))] pt-3"
            style={{ boxShadow: "var(--shadow-pop)" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={spring}
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-line2" />
            <div className="mb-4 t-h2 text-center">{t("sheet_title")}</div>
            <div className="grid grid-cols-2 gap-2.5">
              {items.map((it) => (
                <button
                  key={it.label}
                  onClick={it.onClick}
                  className="flex flex-col items-start gap-3 rounded-card border border-line bg-card p-4 text-right transition-transform active:scale-[0.97]"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-2xl text-accent" style={{ background: "var(--color-accent-soft)" }}>
                    {it.icon}
                  </span>
                  <div>
                    <div className="t-title">{it.label}</div>
                    <div className="t-caption text-ink3">{it.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
