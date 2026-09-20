import { ArrowsIn, ArrowsOut } from "@phosphor-icons/react";
import { cn } from "../lib/utils";

/**
 * Open the prompt box up for editing, and shut it again.
 *
 * Every dock caps its prompt at a few lines so the work behind it stays
 * visible, which is right until the writing *is* the work — a long edit
 * instruction, a scene with four clauses. Then the cap is the problem, and the
 * way out has to be one press away and reversible, because the reason for the
 * cap has not gone anywhere: the wall of outputs is what the dock is for.
 *
 * Offered only once the box is holding more than it can show, and kept while
 * it is open so there is a way back. An empty dock stays clean.
 */
export function PromptExpandButton({
  open,
  onToggle,
  controls,
  className,
  style,
}: {
  open: boolean;
  onToggle: () => void;
  /** Id of the textarea, for `aria-controls`. */
  controls: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      title={open ? "کوچک کردن پرامپت" : "بزرگ کردن پرامپت"}
      aria-label={open ? "کوچک کردن پرامپت" : "بزرگ کردن پرامپت برای ویرایش"}
      /* Lime, like every other chip in a dock that can be pressed. Grey read as
         decoration on a surface where grey is what labels are. */
      className={cn("grid size-6 shrink-0 place-items-center rounded-md transition-colors", className)}
      style={{ background: "var(--vg-primary-a18)", color: "var(--vg-primary-soft)", ...style }}
    >
      {open ? <ArrowsIn size={13} /> : <ArrowsOut size={13} />}
    </button>
  );
}
