import { z } from "zod";
import { readStoredCollection, writeStoredCollection } from "../adapters/browser/storage";

/**
 * Three states, because a job has three outcomes.
 *
 * This was `"running" | "done"`, and the provider mapped everything that was
 * not `succeeded` onto `running` — so a job that failed in three seconds
 * rendered as forever-generating, and the poll that would have corrected it
 * never fires again once the server calls the job settled. The wire has always
 * carried all seven server states plus an `error`; this vocabulary was the part
 * that could not say what happened.
 */
export type GenStatus = "running" | "done" | "failed";

export interface Generation {
  /** Optimistic client key. Server calls must use jobId. */
  id: string;
  jobId?: string | undefined;
  familyId: string;
  variantId: string;
  name: string;
  vendor: string;
  grad: string;
  kind: "image" | "video" | "audio";
  prompt: string;
  /**
   * The aspect that was *asked for*, from the form's own control.
   *
   * Kept because it is all there is until the file exists — a running card has
   * to reserve a box of some shape. It is not what came back: see `outW`/`outH`.
   */
  w: number;
  h: number;
  /**
   * The aspect that *arrived*, measured from the bytes by the server.
   *
   * A provider is entitled to answer at its own size, and they do: a 9:16
   * request (0.5625) comes back 768×1344 (0.5714), a 16:9 one comes back
   * 864×496 (1.7419). Drawing that into a box built from `w`/`h` leaves a strip
   * of the card's gradient showing along two edges — the thin blue lines above
   * and below a finished picture. The API has always sent `width`/`height` on
   * every output; nothing read them.
   */
  outW?: number | undefined;
  outH?: number | undefined;
  durationMs?: number | undefined;
  /** URL in Vgen-owned storage, not an expiring provider URL. */
  outputUrl?: string | undefined;
  /**
   * Every output after the first, for the models that answer with more than
   * one. Suno sends two takes per request; the audio studio lists each, and
   * everywhere else shows the first. They expire with `outputUrl` — one
   * response signs them all.
   */
  moreOutputs?: { url: string; durationMs?: number | undefined }[] | undefined;
  /**
   * The stored asset behind `outputUrl`, so this generation can be an *input*
   * to the next one. "To video" hands a finished image to a video model as its
   * opening frame, and the quote names references by asset id — the URL is
   * signed and expiring, so it is the wrong handle to keep for that.
   */
  outputAssetId?: string | undefined;
  /**
   * When `outputUrl` stops working, from the job's `urlsExpireAt`.
   *
   * The URL is signed for an hour. This list lives in localStorage forever, so
   * without an expiry to check against, every gallery older than that hour was
   * a wall of broken images — the file was fine, the signature was not, and
   * nothing ever asked for a new one. The API has always sent this; nothing
   * read it.
   */
  outputUrlExpiresAt?: number | undefined;
  /**
   * What this generation was actually submitted with, so it can be run again
   * as it was run — the aspect, the resolution, the duration, the seed.
   *
   * Only present on rows read from the server. A row this tab started
   * optimistically already knows its own inputs from the form that made it.
   */
  params?: Record<string, unknown> | undefined;
  /**
   * The files it ran against, keyed by the slot they filled, as asset ids.
   *
   * "Generate again" needs these and nothing else would do: the reference is
   * part of the request, not decoration on it, and re-running seedance with the
   * prompt but without the first frame is a different generation that costs the
   * same money.
   */
  refAssetIds?: Record<string, string[]> | undefined;
  /** Server-computed perceptual hash, opaque to the client. */
  phash?: string | undefined;
  status: GenStatus;
  /**
   * Why it failed, straight from the job. `code` is one of the worker's
   * allow-listed public codes — never provider text — and `docs/API.md` lists
   * what a person can do about each. Present only when `status` is `failed`.
   */
  error?: { code: string; message: string } | undefined;
  progress?: number | undefined;
  createdAt: number;
}

const KEY = "vgen:gens";

const GenerationSchema: z.ZodType<Generation> = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1).optional(),
  familyId: z.string().min(1),
  variantId: z.string().min(1),
  name: z.string(),
  vendor: z.string(),
  grad: z.string(),
  kind: z.enum(["image", "video", "audio"]),
  prompt: z.string(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  outW: z.number().int().positive().optional(),
  outH: z.number().int().positive().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  outputUrl: z.string().min(1).optional(),
  moreOutputs: z.array(z.object({ url: z.string().min(1), durationMs: z.number().int().nonnegative().optional() })).optional(),
  outputAssetId: z.string().min(1).optional(),
  outputUrlExpiresAt: z.number().int().nonnegative().optional(),
  phash: z.string().min(1).optional(),
  status: z.enum(["running", "done", "failed"]),
  error: z.object({ code: z.string().min(1), message: z.string() }).optional(),
  progress: z.number().min(0).max(100).optional(),
  createdAt: z.number().int().nonnegative(),
});

export function loadGenerations(): Generation[] {
  return readStoredCollection(KEY, GenerationSchema);
}

export function saveGenerations(gens: Generation[]): void {
  writeStoredCollection(KEY, gens);
}

/**
 * The shape to draw this generation in: what arrived, or what was asked for.
 *
 * Both screens size a box and then paint the file into it. Sizing from the
 * request is what puts gradient bands around a finished picture, so the real
 * measurement wins wherever there is one — and there only is one once the job
 * has produced a file, which is exactly when the box stops being a placeholder.
 */
export function displayAspect(gen: Generation): { w: number; h: number } {
  return gen.outW && gen.outH ? { w: gen.outW, h: gen.outH } : { w: gen.w, h: gen.h };
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
