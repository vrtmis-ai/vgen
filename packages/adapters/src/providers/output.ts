import type { GenerationOutput, Modality } from "./types";

/**
 * What kind of thing is behind a provider's result URL.
 *
 * Shared by every adapter because no provider we have integrated says. KIE
 * hands back a bare URL list and WaveSpeed hands back `data.outputs`, and
 * neither carries a content type — so the extension is the only signal, and
 * the modality on the `provider_models` row is the answer when there isn't
 * one. Signed URLs with a query string are the common case where there isn't.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

const FALLBACK_MIME: Record<Modality, string> = {
  image: "image/png",
  video: "video/mp4",
  audio: "audio/mpeg",
  text: "text/plain",
};

export function describeOutput(url: string, modality: Modality): GenerationOutput {
  const path = url.split(/[?#]/)[0] ?? url;
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  const mimeType = (extension && MIME_BY_EXTENSION[extension]) || FALLBACK_MIME[modality];
  const kind = mimeType.startsWith("image/")
    ? "image"
    : mimeType.startsWith("video/")
      ? "video"
      : mimeType.startsWith("audio/")
        ? "audio"
        : modality;
  return { url, kind, mimeType };
}
