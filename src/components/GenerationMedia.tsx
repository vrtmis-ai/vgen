import { useEffect, useRef, useState } from "react";
import type { Generation } from "../lib/gallery";

/**
 * The file a generation produced, on screen.
 *
 * One component because there was previously none, and the two screens that
 * should have had one both drew `g.grad` instead: the gallery card was a
 * coloured rectangle where the picture goes, and the result screen — the page
 * whose entire job is showing the thing that was just paid for — painted the
 * same gradient and captioned it "sample". Neither looked broken, which is why
 * both survived.
 *
 * Keyed off `g.kind`, never off the URL. These are signed links to our own
 * store and the signature is the last thing in the string, so `isVideoUrl`'s
 * extension test never matches one and every clip would be handed to an `<img>`
 * that cannot decode it. The catalogue already recorded what it made.
 *
 * The gradient stays behind this as the backdrop for a running job and for the
 * moment before a frame decodes, so callers keep painting it and this returns
 * null rather than covering it with a placeholder of its own.
 */
export function GenerationMedia({
  gen,
  fit = "cover",
  controls = false,
}: {
  gen: Generation;
  /** `cover` fills a card; `contain` shows a whole frame without cropping it. */
  fit?: "cover" | "contain";
  /** Player chrome. Off in a grid of cards, on where the file is the subject. */
  controls?: boolean;
}) {
  if (!gen.outputUrl) return null;

  if (gen.kind === "audio") {
    // Audio has no frame, so it is the one kind that renders as a control
    // rather than as a picture — and only when asked. A grid of cards has no
    // room for a player, and an invisible one would be a card that looks empty.
    if (!controls) return null;
    return (
      <div className="absolute inset-0 flex items-center justify-center px-6">
        <audio src={gen.outputUrl} controls className="w-full" />
      </div>
    );
  }

  // Written out rather than interpolated: Tailwind generates classes by
  // scanning source text, so `object-${fit}` produces a class that exists in
  // the markup and in no stylesheet.
  const className = `absolute inset-0 size-full ${fit === "contain" ? "object-contain" : "object-cover"}`;
  return gen.kind === "video" ? (
    controls ? (
      <video src={gen.outputUrl} className={className} controls playsInline />
    ) : (
      <CardVideo src={gen.outputUrl} className={className} />
    )
  ) : (
    <img src={gen.outputUrl} alt={gen.prompt || ""} className={className} loading="lazy" decoding="async" />
  );
}

/**
 * A clip on a card: still until the pointer arrives, playing while it stays.
 *
 * It used to autoplay always, which is defensible — `muted` makes autoplay
 * legal everywhere, and a card that only plays on hover looks like a broken
 * image on a phone, where there is no hover. But a wall of twelve clips all
 * running at once is twelve decoders, and none of them is the one being looked
 * at. So the rule is the device's: where there is a pointer, the clip waits for
 * it and plays the real file at full quality under the cursor — which is the
 * point, being able to see what was made without opening it. Where there is no
 * pointer, nothing changes and it plays as before.
 *
 * `preload="metadata"` is what gives the resting card its first frame; without
 * it a paused video is a blank rectangle.
 */
function CardVideo({ src, className }: { src: string; className: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [hoverable, setHoverable] = useState<boolean | null>(null);

  useEffect(() => {
    setHoverable(window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false);
  }, []);

  useEffect(() => {
    if (!hoverable) return;
    const element = video.current;
    /* Listened for on the card, not on the clip. The action rail overlays the
       clip on hover, so a pointer travelling to the download button leaves the
       `<video>` and the clip would stop under the hand reaching for it.
       `pointerenter`/`pointerleave` do not fire on moves between a node's own
       descendants, which is exactly the behaviour this wants.

       Found by the marker rather than by `parentElement`, which was wrong
       wherever the media is not a direct child of the card: on the model page
       the clip sits inside the open button, and the rail is that button's
       sibling, so the pointer left on its way to the controls — the exact
       problem this listener exists to avoid. In کارهای من's list the parent is
       a 56px thumbnail. Falls back to the parent so an unmarked caller keeps
       its old behaviour rather than losing playback entirely. */
    const card = element?.closest<HTMLElement>("[data-generation-card]") ?? element?.parentElement;
    if (!element || !card) return;

    // Rejects when the element is detached mid-gesture; nothing to recover.
    const play = () => void element.play().catch(() => undefined);
    const pause = () => {
      element.pause();
      // Back to the first frame, so a wall of clips reads as a set of stills
      // again rather than as a dozen videos each frozen somewhere different.
      element.currentTime = 0;
    };

    card.addEventListener("pointerenter", play);
    card.addEventListener("pointerleave", pause);
    card.addEventListener("focusin", play);
    card.addEventListener("focusout", pause);
    return () => {
      card.removeEventListener("pointerenter", play);
      card.removeEventListener("pointerleave", pause);
      card.removeEventListener("focusin", play);
      card.removeEventListener("focusout", pause);
    };
  }, [hoverable]);

  return (
    <video
      ref={video}
      src={src}
      className={className}
      muted
      loop
      playsInline
      preload="metadata"
      /* Undecided on the first render — `matchMedia` is a browser fact and the
         server has no answer — so it starts still. A touch device turns it on
         one tick later, which is before anything has decoded. */
      autoPlay={hoverable === false}
    />
  );
}
