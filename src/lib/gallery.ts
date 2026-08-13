import { z } from "zod";
import { readStoredCollection, writeStoredCollection } from "../adapters/browser/storage";

export type GenStatus = "running" | "done";

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
  w: number;
  h: number;
  durationMs?: number | undefined;
  /** URL in Vgen-owned storage, not an expiring provider URL. */
  outputUrl?: string | undefined;
  /** Server-computed perceptual hash, opaque to the client. */
  phash?: string | undefined;
  status: GenStatus;
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
  durationMs: z.number().int().nonnegative().optional(),
  outputUrl: z.string().min(1).optional(),
  phash: z.string().min(1).optional(),
  status: z.enum(["running", "done"]),
  progress: z.number().min(0).max(100).optional(),
  createdAt: z.number().int().nonnegative(),
});

export function loadGenerations(): Generation[] {
  return readStoredCollection(KEY, GenerationSchema);
}

export function saveGenerations(gens: Generation[]): void {
  writeStoredCollection(KEY, gens);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
