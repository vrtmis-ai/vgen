import { useMutation, useQueries, type Query } from "@tanstack/react-query";
import { useAppServices } from "../../runtime/AppServices";
import type { CreateGenerationRequest, GenerationJob, QuoteGenerationRequest } from "../../runtime/contracts/generation";

export const CREATE_GENERATION_MUTATION_KEY = ["create-generation"] as const;

export function useCreateGeneration() {
  const services = useAppServices();
  return useMutation({
    mutationKey: CREATE_GENERATION_MUTATION_KEY,
    mutationFn: async ({ quote, idempotencyKey }: { quote: QuoteGenerationRequest; idempotencyKey: string }) => {
      const generationQuote = await services.generation.quote(quote);
      const createRequest: CreateGenerationRequest = { quoteId: generationQuote.id, idempotencyKey };
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
      queryFn: ({ signal }) => services.generation.getJob(jobId, { signal }),
      refetchInterval: (query: Query<GenerationJob>) => {
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
