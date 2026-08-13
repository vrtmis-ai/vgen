import type { AppServices } from "../../app/AppServices";
import type { GalleryPage, GalleryQuery } from "../../app/contracts/gallery";
import type { GenerationJob, GenerationQuote, QuoteGenerationRequest } from "../../app/contracts/generation";
import { getFamily } from "../../data/models";
import { priceCoins } from "../../data/pricing";

interface StoredJob {
  job: GenerationJob;
  prompt: string;
  createdAt: number;
}

export function createDemoGenerationAdapters(now: () => number): {
  generation: AppServices["generation"];
  gallery: AppServices["gallery"];
} {
  let quoteSequence = 0;
  let jobSequence = 0;
  const quotes = new Map<string, { quote: GenerationQuote; request: QuoteGenerationRequest }>();
  const jobs = new Map<string, StoredJob>();
  const idempotentJobs = new Map<string, string>();

  function currentJob(stored: StoredJob): GenerationJob {
    const elapsed = Math.max(0, now() - stored.createdAt);
    if (elapsed <= 250) return stored.job;
    if (elapsed < 2_500) {
      return {
        ...stored.job,
        status: "running",
        progress: Math.max(1, Math.min(99, Math.round((elapsed / 2_500) * 100))),
        updatedAt: now(),
      };
    }
    return { ...stored.job, status: "done", progress: 100, updatedAt: now() };
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
        catalogVersion: "demo-catalog-v1",
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
        progress: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        outputAssetIds: [],
      };
      jobs.set(id, { job, prompt: storedQuote.request.prompt, createdAt: timestamp });
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
      const limit = Math.min(100, Math.max(1, query.limit ?? 30));
      const items = [...jobs.values()]
        .map((stored) => ({ stored, job: currentJob(stored) }))
        .filter(({ job }) => !query.kind || getFamily(job.familyId)?.kind === query.kind)
        .sort((a, b) => b.job.createdAt - a.job.createdAt)
        .slice(0, limit)
        .map(({ stored, job }) => {
          const family = getFamily(job.familyId)!;
          return {
            id: job.id,
            familyId: job.familyId,
            variantId: job.variantId,
            name: family.name,
            vendor: family.vendor,
            kind: family.kind,
            prompt: stored.prompt,
            status: job.status,
            progress: job.progress,
            createdAt: job.createdAt,
          };
        });
      return { items };
    },
  };

  return { generation, gallery };
}
