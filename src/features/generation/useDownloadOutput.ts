import { useCallback } from "react";
import type { Generation } from "../../lib/gallery";
import { useAppServices } from "../../runtime/AppServices";

/**
 * Save the file a generation produced.
 *
 * Through the API, not straight at the file. `<a download>` is honoured only
 * for same-origin URLs, and an output URL is signed against the object store's
 * host — `127.0.0.1:9000` locally, `files.deev.ir` in production — so the
 * attribute is ignored and the browser does the other thing it knows how to do
 * with a picture: opens it in a tab, which is not what the button said. The
 * route answers 302 to the same file signed to arrive as an attachment, with
 * the name and extension decided server-side from the stored mime type.
 *
 * Written twice before this — on the result page and in the image wall — and
 * about to be written a third, fourth and fifth time as the action rail reached
 * the other canvases.
 */
export function useDownloadOutput(): (gen: Generation) => void {
  const services = useAppServices();
  return useCallback(
    (gen: Generation) => {
      if (!gen.jobId || !gen.outputUrl) return;
      const el = document.createElement("a");
      el.href = services.generation.downloadUrl(gen.jobId);
      el.rel = "noopener";
      el.click();
    },
    [services],
  );
}
