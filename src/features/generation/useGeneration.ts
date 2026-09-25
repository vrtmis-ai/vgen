import { useMutation, useQueries, useQuery, type Query } from "@tanstack/react-query";
import { useAppServices } from "../../runtime/AppServices";
import type { CreateGenerationRequest, GenerationJob, QuoteGenerationRequest } from "../../runtime/contracts/generation";

export const CREATE_GENERATION_MUTATION_KEY = ["create-generation"] as const;

export function useCreateGeneration() {
  const services = useAppServices();
  return useMutation({
    mutationKey: CREATE_GENERATION_MUTATION_KEY,
    mutationFn: async ({ quote, idempotencyKey }: { quote: QuoteGenerationRequest; idempotencyKey: string }) => {
      const generationQuote = await services.generation.quote(quote);
      // The settings go up a second time, with the quote id. They have to hash
      // to exactly what was priced, which is what stops a cheap quote being
      // redeemed for an expensive generation — so the prompt travels with them
      // here too, and the adapter folds both into `params` the same way twice.
      const createRequest: CreateGenerationRequest = {
        quoteId: generationQuote.id,
        idempotencyKey,
        input: quote.input,
        prompt: quote.prompt,
      };
      const job = await services.generation.create(createRequest);
      return { quote: generationQuote, job };
    },
  });
}

export function useGenerationJobs(jobIds: readonly string[]) {
  const services = useAppServices();
  const results = useQueries({
    queries: jobIds.map((jobId) => ({
      queryKey: ["generation-job", jobId] as const,
      /* `signal` is annotated rather than inferred. useQueries infers the whole
         options object from the array literal, and that inference stopped
         resolving once GenerationJob grew its `params` record — the context
         argument fell back to implicit any. The type it should have had is not
         in question, so it is written down. */
      queryFn: ({ signal }: { signal: AbortSignal }) => services.generation.getJob(jobId, { signal }),
      refetchInterval: (query: Query<GenerationJob>) => {
        /* A failed read is not a pending job. `data` is undefined both before
           the first answer and after an error, and treating the second as the
           first polled a job that cannot be read once a second forever: a
           browser holding sixteen ids the server had never heard of sent
           sixteen requests a second for as long as the tab stayed open, and
           kept the error banner up the whole time.
           `retry` above still covers a blip; when those are spent the banner's
           own retry is the way back, which is what it is for. */
        if (query.state.status === "error") return false;
        const status = query.state.data?.status;
        return status === undefined || status === "queued" || status === "running" ? 1_000 : false;
      },
      retry: 2,
    })),
  });
  return {
    jobs: results.flatMap((result) => (result.data ? [result.data] : [])),
    error: results.find((result) => result.error)?.error ?? null,
    isFetching: results.some((result) => result.isFetching),
    retry: async () => {
      await Promise.all(results.filter((result) => result.error).map((result) => result.refetch()));
    },
  };
}

/**
 * The account's generation history, from the database.
 *
 * `GET /api/v1/gallery` has existed, worked and been tested since Phase H, with
 * an HTTP adapter wired into the container — and was called by nothing. The
 * gallery read `localStorage`, so a second device showed an empty wall over a
 * full table, and clearing site data looked like losing your work.
 *
 * One page, not an infinite scroll: the wall paginates on `nextCursor` and this
 * takes the newest 60, which is the whole history for almost everyone and the
 * recent past for the rest. Gated on `enabled` because an anonymous visitor has
 * no history and the route would answer 401.
 */
export function useGalleryHistory(enabled: boolean) {
  const services = useAppServices();
  return useQuery({
    queryKey: ["gallery-history"] as const,
    queryFn: ({ signal }) => services.gallery.list({ limit: 60 }, { signal }),
    enabled,
    // The list only changes when this browser starts something — which it
    // already knows about locally — so refetching on every focus would spend a
    // request to learn nothing.
    staleTime: 60_000,
    retry: 1,
  });
}
