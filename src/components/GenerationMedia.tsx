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
    // `muted` is what makes autoplay legal in every browser, and a card that
    // only plays on hover is a card that looks like a broken image until
    // touched — there is no hover on a phone.
    <video
      src={gen.outputUrl}
      className={className}
      controls={controls}
      muted={!controls}
      loop={!controls}
      autoPlay={!controls}
      playsInline
    />
  ) : (
    <img src={gen.outputUrl} alt={gen.prompt || ""} className={className} />
  );
}
