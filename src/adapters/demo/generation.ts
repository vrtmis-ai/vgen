import type { AppServices } from "../../runtime/AppServices";
import type { GalleryPage, GalleryQuery } from "../../runtime/contracts/gallery";
import type { GenerationJob, GenerationQuote, QuoteGenerationRequest } from "../../runtime/contracts/generation";
import { getFamily } from "../../data/models";
import { priceCoins } from "../../data/pricing";

interface StoredJob {
  job: GenerationJob;
  createdAt: number;
}

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
  const idempotentJobs = new Map<string, string>();

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
    if (elapsed < 2_500) return { ...stored.job, status: "running", updatedAt: now() };
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
      const id = `demo-job-${++jobSequence}`;
      const timestamp = now();
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
      jobs.set(id, { job, createdAt: timestamp });
      idempotentJobs.set(request.idempotencyKey, id);
      return job;
    },

    async getJob(jobId) {
      const stored = jobs.get(jobId);
      if (!stored) throw new Error("Demo job was not found");
      const job = currentJob(stored);
      stored.job = job;
      return job;
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
