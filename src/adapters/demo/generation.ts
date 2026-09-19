import type { AppServices } from "../../runtime/AppServices";
import type { GalleryPage, GalleryQuery } from "../../runtime/contracts/gallery";
import type { GenerationJob, GenerationQuote, QuoteGenerationRequest } from "../../runtime/contracts/generation";
import { getFamily } from "../../data/models";
import { priceCoins } from "../../data/pricing";
import { ApiError } from "../../runtime/apiError";

interface StoredJob {
  job: GenerationJob;
  createdAt: number;
  /** The code this job is rehearsing a failure for; see `FAILURE_CUE`. */
  fails?: string;
  /** How long it stays running, for looking at what is drawn while it does. */
  runsFor?: number;
}

/**
 * How to see a failure without one happening.
 *
 * A generation can fail in a dozen ways — the provider refusing the words, the
 * request never reaching it, the file coming back unstorable — and each one has
 * its own sentence in `features/generation/validation`. None of them were
 * reachable in demo mode, so the screens that carry them were the only screens
 * nobody could look at. A prompt that starts with `fail:<code>` settles the job
 * with that code; `throw:<code>` refuses the submission instead, which is the
 * other half — a request that never became a job at all.
 *
 * Demo mode only. Nothing reads these prefixes in production, where the codes
 * come from the worker.
 */
const FAILURE_CUE = /^\s*(fail|throw):([a-z_]+)/i;

/**
 * How to look at a generation that is still being made.
 *
 * A demo job settles in two and a half seconds, which is the right length for
 * trying the product and far too short for looking at the surface it draws
 * while it runs. A prompt starting with `slow:<seconds>` holds it there.
 * Capped at five minutes, and demo only, like `FAILURE_CUE` above it.
 */
const SLOW_CUE = /^\s*slow:(\d{1,3})/i;

/**
 * A stand-in placeholder, so a demo gallery has something to draw.
 *
 * A 1×1 transparent GIF as a data URI rather than a real picture: demo mode has
 * to work with no network at all, and the point being demonstrated is the
 * layout and the state machine, not the image.
 */
const PLACEHOLDER_URL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function createDemoGenerationAdapters(now: () => number): {
  generation: AppServices["generation"];
  gallery: AppServices["gallery"];
  assets: AppServices["assets"];
} {
  let quoteSequence = 0;
  let jobSequence = 0;
  let assetSequence = 0;
  const quotes = new Map<string, { quote: GenerationQuote; request: QuoteGenerationRequest }>();
  const jobs = new Map<string, StoredJob>();
  const recalled = new Map<string, StoredJob>();
  const idempotentJobs = new Map<string, string>();

  /**
   * A job an earlier page load made, answered from its id.
   *
   * The jobs live in this closure, and the generations that name them live in
   * localStorage. So every reload — a refresh, a dev-server restart, a full
   * HMR reload — left the list pointing at jobs nothing here had heard of. The
   * provider polls a finished job again once its link expires, the question
   * threw, and the provider drew its full-page 503. The poll asked again, the
   * page came back, it threw again — a page flickering between the two and
   * rebuilding the form under whoever was typing. A server keeps its jobs, and
   * the demo has to look like it does.
   *
   * So an id carries its own start (`demo-job-<ms, base 36>-<n>`), and a job
   * missing from the map is rebuilt from it and walked forward like any other.
   * Ids from before carried only a counter — which also collided across
   * reloads — and they are answered as long finished, which they are.
   *
   * Held apart from `jobs`, so `gallery.list` does not return a row with no
   * model and no prompt to be merged over the local row that has both.
   */
  function recall(jobId: string): StoredJob | undefined {
    const known = recalled.get(jobId);
    if (known) return known;
    const match = /^demo-job-(?:([0-9a-z]+)-)?\d+$/.exec(jobId);
    if (!match) return undefined;
    const createdAt = match[1] ? parseInt(match[1], 36) : 0;
    const stored: StoredJob = {
      createdAt,
      job: {
        id: jobId,
        familyId: "demo",
        variantId: "demo",
        status: "queued",
        coins: 0,
        prompt: "",
        createdAt,
        updatedAt: createdAt,
        outputs: [],
        urlsExpireAt: null,
      },
    };
    recalled.set(jobId, stored);
    return stored;
  }

  /**
   * Walks a job through the states the real one does, on a timer.
   *
   * `succeeded` rather than `done`, because that is the word the database uses
   * and therefore the word that comes over the wire. Demo mode's whole claim is
   * that a screen built against it behaves the same in production, and a
   * private vocabulary here would break that quietly.
   */
  function currentJob(stored: StoredJob): GenerationJob {
    const elapsed = Math.max(0, now() - stored.createdAt);
    if (elapsed <= 250) return stored.job;
    if (elapsed < (stored.runsFor ?? 2_500)) return { ...stored.job, status: "running", updatedAt: now() };
    if (stored.fails) {
      /* Settled the way the worker settles a refusal: a code, a fixed sentence,
         no outputs, and — the part that matters to whoever paid — nothing
         charged. */
      return {
        ...stored.job,
        status: "failed",
        updatedAt: now(),
        outputs: [],
        error: { code: stored.fails, message: "Demo failure rehearsal." },
      };
    }
    return {
      ...stored.job,
      status: "succeeded",
      updatedAt: now(),
      outputs: [
        {
          assetId: `demo-asset-${stored.job.id}`,
          url: PLACEHOLDER_URL,
          kind: "image",
          mimeType: "image/gif",
          width: 1,
          height: 1,
          durationMs: null,
        },
      ],
      urlsExpireAt: now() + 60 * 60_000,
    };
  }

  const generation: AppServices["generation"] = {
    async quote(request) {
      const family = getFamily(request.familyId);
      const variant = family?.variants.find((candidate) => candidate.id === request.variantId);
      if (!family || !variant) throw new Error("Demo catalog does not contain the requested model variant");
      const coins = priceCoins(variant, request.input, { chars: request.prompt.length, clipSeconds: 0 });
      if (coins == null) throw new Error("Demo pricing does not support this combination");
      const quote: GenerationQuote = {
        id: `demo-quote-${++quoteSequence}`,
        coins,
        expiresAt: now() + 5 * 60_000,
        // Always present on the real payload, because the price is not the only
        // reason a generation might not start.
        concurrency: { running: jobs.size, limit: 8 },
      };
      quotes.set(quote.id, { quote, request });
      return quote;
    },

    async create(request) {
      const existingId = idempotentJobs.get(request.idempotencyKey);
      if (existingId) return currentJob(jobs.get(existingId)!);
      const storedQuote = quotes.get(request.quoteId);
      if (!storedQuote) throw new Error("Demo quote was not found");
      if (storedQuote.quote.expiresAt < now()) throw new Error("Demo quote has expired");
      const cue = FAILURE_CUE.exec(storedQuote.request.prompt);
      if (cue && cue[1]?.toLowerCase() === "throw") {
        // A submission that never becomes a job: the shape a screen sees when
        // the request is refused, or never arrives at all.
        throw new ApiError({ code: cue[2] ?? "submit_failed", message: "Demo submission refusal.", status: 422 });
      }
      const timestamp = now();
      // Its start in the id, so a later page load can still answer for it.
      const id = `demo-job-${timestamp.toString(36)}-${++jobSequence}`;
      const job: GenerationJob = {
        id,
        familyId: storedQuote.request.familyId,
        variantId: storedQuote.request.variantId,
        status: "queued",
        coins: storedQuote.quote.coins,
        prompt: storedQuote.request.prompt,
        createdAt: timestamp,
        updatedAt: timestamp,
        outputs: [],
        urlsExpireAt: null,
      };
      const slow = SLOW_CUE.exec(storedQuote.request.prompt);
      const runsFor = slow ? Math.min(300, Number(slow[1])) * 1_000 : undefined;
      jobs.set(id, { job, createdAt: timestamp, ...(cue ? { fails: cue[2] } : {}), ...(runsFor ? { runsFor } : {}) });
      idempotentJobs.set(request.idempotencyKey, id);
      return job;
    },

    async getJob(jobId) {
      const stored = jobs.get(jobId) ?? recall(jobId);
      // What the API answers for an id this account does not have — the same
      // ApiError, so a screen that handles one handles the other.
      if (!stored) throw new ApiError({ code: "job_not_found", message: "No such job.", status: 404 });
      const job = currentJob(stored);
      stored.job = job;
      return job;
    },

    // Demo outputs are data/blob URLs that already live in the page, so there
    // is nothing to route through an API that is not running. Handing back the
    // output itself keeps the button honest in demo mode.
    downloadUrl(jobId, index = 0) {
      return (jobs.get(jobId) ?? recalled.get(jobId))?.job.outputs[index]?.url ?? "";
    },

    // A hard delete here, where the server's is soft: the map is the demo's
    // whole history and it keeps no ledger for the row to go on standing for.
    async remove(jobId) {
      jobs.delete(jobId);
      recalled.delete(jobId);
    },
  };

  const gallery: AppServices["gallery"] = {
    async list(query: GalleryQuery = {}): Promise<GalleryPage> {
      const limit = Math.min(60, Math.max(1, query.limit ?? 24));
      const items = [...jobs.values()]
        .map((stored) => currentJob(stored))
        .filter((job) => !query.kind || getFamily(job.familyId)?.kind === query.kind)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, limit);
      return { items };
    },
  };

  const assets: AppServices["assets"] = {
    async upload(file) {
      return {
        id: `demo-asset-${++assetSequence}`,
        url: PLACEHOLDER_URL,
        kind: "image",
        mimeType: file.type || "image/png",
        byteSize: file.size,
        deduplicated: false,
        urlExpiresAt: now() + 60 * 60_000,
      };
    },
  };

  return { generation, gallery, assets };
}
