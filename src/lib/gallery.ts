export type GenStatus = "running" | "done";

export interface Generation {
  /** Local optimistic key, minted client-side so a card can render before the
   *  server answers. NOT the job's identity — see `jobId`. */
  id: string;
  /**
   * The server's job id, and the only one that may be used to fetch or settle
   * anything. Absent until `/generate` returns. Client-minted ids must never
   * reach an endpoint: whoever picks the id picks whose job they read.
   */
  jobId?: string | undefined;
  familyId: string;
  variantId: string;
  name: string;
  vendor: string;
  grad: string;
  kind: "image" | "video" | "audio";
  prompt: string;
  /** Aspect, for laying out the card. Meaningless for `kind: "audio"` — that has
   *  a duration instead, which is why `durationMs` exists alongside. */
  w: number;
  h: number;
  durationMs?: number | undefined;
  /**
   * The output, in OUR storage — never a KIE URL. KIE deletes generated media on
   * a 24-hour-to-14-day clock (its own docs disagree with themselves), so a
   * gallery holding provider links empties itself. The bytes get copied inside
   * the completion handler, not in a nightly job.
   */
  outputUrl?: string | undefined;
  /**
   * Perceptual hash of the output, computed SERVER-side during that copy and
   * opaque here. The client carries the field and never populates it.
   *
   * It exists from day one on purpose. Community reels are matched against the
   * uploader's own library, and adding this later means re-downloading and
   * re-hashing every user's entire history instead of spending a few
   * milliseconds on bytes already in hand.
   */
  phash?: string | undefined;
  status: GenStatus;
  createdAt: number;
}

const KEY = "vgen:gens";

export function loadGenerations(): Generation[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]") as Generation[];
    // a "running" job can't survive a reload (the mock isn't actually running) — settle it
    return arr.map((g) => (g.status === "running" ? { ...g, status: "done" } : g));
  } catch {
    return [];
  }
}

export function saveGenerations(gens: Generation[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(gens));
  } catch {
    /* ignore */
  }
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
