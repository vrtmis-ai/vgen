"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultInput, variantControls, type Variant } from "../../data/models";
import type { InputMap, RefMap } from "../../components/controls";
import { loadGenerations, saveGenerations, uid, type Generation } from "../../lib/gallery";
import { currentAspect } from "../../features/generation/aspect";
import { validateGenerationInput } from "../../features/generation/validation";
import { useCatalogFamilies } from "../../features/catalog/CatalogProvider";
import { useCreateGeneration, useGenerationJobs } from "../../features/generation/useGeneration";
import { SystemState } from "../../components/SystemState";
import { ApiError } from "../../adapters/http/client";
import type { GenerationQuote } from "../contracts/generation";
import { useNavigation } from "./NavigationProvider";

interface StartedGeneration {
  generation: Generation;
  quote: GenerationQuote;
}

interface Generations {
  gens: Generation[];
  startGeneration: (familyId: string, prompt: string, input: InputMap, variant: Variant, refs: RefMap) => Promise<StartedGeneration | null>;
  /** Fire-and-forget start used by the studio docks, which have no result to await. */
  requestGeneration: (familyId: string, prompt: string, input: InputMap, variant: Variant) => void;
  regenerate: (previous: Generation) => Promise<void>;
  markDone: (id: string) => void;
}

const GenerationsContext = createContext<Generations | null>(null);

/**
 * The one piece of genuinely shared mutable state App.tsx owned.
 *
 * It also owns the polling for those generations' jobs, which is why the job
 * error gate lives here rather than in the layout above: whoever owns a query
 * owns its failure state. The same goes for `operationError`, which can only be
 * produced by `startGeneration`.
 */
export function GenerationsProvider({ children }: { children: ReactNode }) {
  const families = useCatalogFamilies();
  const navigation = useNavigation();
  const createGeneration = useCreateGeneration();
  const pendingRef = useRef(false);
  const [operationError, setOperationError] = useState<Error | null>(null);

  // Starts empty on both server and client, then loads once mounted. Reading
  // localStorage in the useState initialiser — as this did — runs during render,
  // which on the server produces [] and on the client produces the stored list,
  // and React reports the difference as a hydration mismatch.
  const [gens, setGens] = useState<Generation[]>([]);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setGens(loadGenerations());
    setHydrated(true);
  }, []);
  useEffect(() => {
    // Guarded: without this the empty pre-hydration list overwrites real storage.
    if (hydrated) saveGenerations(gens);
  }, [gens, hydrated]);

  const runningJobIds = useMemo(
    () => gens.flatMap((generation) => (generation.status === "running" && generation.jobId ? [generation.jobId] : [])),
    [gens],
  );
  const jobQueries = useGenerationJobs(runningJobIds);
  const jobStateKey = jobQueries.jobs.map((job) => `${job.id}:${job.status}:${job.progress ?? ""}`).join("|");
  useEffect(() => {
    if (!jobStateKey) return;
    const byId = new Map(jobQueries.jobs.map((job) => [job.id, job]));
    setGens((previous) =>
      previous.map((generation) => {
        const job = generation.jobId ? byId.get(generation.jobId) : undefined;
        if (!job) return generation;
        return { ...generation, status: job.status === "done" ? "done" : "running", progress: job.progress };
      }),
    );
  }, [jobQueries.jobs, jobStateKey]);

  const startGeneration = useCallback(
    async (familyId: string, prompt: string, input: InputMap, variant: Variant, refs: RefMap) => {
      const family = families.find((candidate) => candidate.id === familyId);
      const catalogVariant = family?.variants.find((candidate) => candidate.id === variant.id);
      if (!family || !catalogVariant) return null;
      if (!validateGenerationInput({ family, variant, prompt, input, refs }).valid) return null;
      if (Object.values(refs).some((files) => files.length > 0)) return null;
      if (pendingRef.current) return null;
      const aspect = currentAspect(variantControls(family, variant), input);
      // TODO(backend): POST each File in `refs` to /uploads and send the returned URLs
      // with the generate request, keyed by slot (image_url, first_frame_url, …).
      // `refs` deliberately stops here — Files aren't serialisable, so it can't go
      // into the persisted Generation, and there is no upload endpoint yet.
      pendingRef.current = true;
      try {
        const { job, quote } = await createGeneration.mutateAsync({
          quote: { familyId, variantId: variant.id, prompt, input, referenceAssetIds: {} },
          idempotencyKey: `vgen-${uid()}-${uid()}`,
        });
        const generation: Generation = {
          id: uid(),
          jobId: job.id,
          familyId: family.id,
          variantId: variant.id,
          name: family.name,
          vendor: family.vendor,
          grad: family.grad,
          kind: family.kind,
          prompt,
          w: aspect.w,
          h: aspect.h,
          status: "running",
          progress: job.progress ?? 0,
          createdAt: job.createdAt,
        };
        setGens((previous) => [generation, ...previous]);
        return { generation, quote };
      } finally {
        pendingRef.current = false;
      }
    },
    [createGeneration, families],
  );

  const requestGeneration = useCallback(
    (familyId: string, prompt: string, input: InputMap, variant: Variant) => {
      void startGeneration(familyId, prompt, input, variant, {}).catch((error: unknown) =>
        setOperationError(error instanceof Error ? error : new Error(String(error))),
      );
    },
    [startGeneration],
  );

  const regenerate = useCallback(
    async (previous: Generation) => {
      const family = families.find((candidate) => candidate.id === previous.familyId);
      const variant = family?.variants.find((candidate) => candidate.id === previous.variantId);
      if (!family || !variant) return;
      const started = await startGeneration(family.id, previous.prompt, defaultInput(variantControls(family, variant)), variant, {});
      if (!started) return;
      // replace-in-place: back from the new result returns to where the user
      // was before the previous result, not to a chain of stale results
      navigation.openResult(started.generation.id, { replace: true });
    },
    [families, navigation, startGeneration],
  );

  const markDone = useCallback((id: string) => {
    setGens((previous) => previous.map((generation) => (generation.id === id ? { ...generation, status: "done" } : generation)));
  }, []);

  const value = useMemo<Generations>(
    () => ({ gens, startGeneration, requestGeneration, regenerate, markDone }),
    [gens, markDone, regenerate, requestGeneration, startGeneration],
  );

  if (operationError) {
    return (
      <SystemState
        kind="service"
        title="ساخت شروع نشد"
        description="درخواست ساخت کامل نشد و اعتباری در این صفحه کسر نشده است. به فضای کار برگرد و دوباره تلاش کن."
        primaryLabel="بازگشت به فضای کار"
        onPrimary={() => setOperationError(null)}
        requestId={operationError instanceof ApiError ? operationError.requestId : undefined}
      />
    );
  }
  if (jobQueries.error) {
    return (
      <SystemState
        kind="service"
        title="وضعیت خروجی‌ها به‌روز نشد"
        description="ارتباط با صف پردازش موقتاً قطع شده است. خود job حذف نشده؛ دوباره وضعیتش را دریافت کن."
        onPrimary={() => void jobQueries.retry()}
        requestId={jobQueries.error instanceof ApiError ? jobQueries.error.requestId : undefined}
        busy={jobQueries.isFetching}
      />
    );
  }

  return <GenerationsContext.Provider value={value}>{children}</GenerationsContext.Provider>;
}

export function useGenerations(): Generations {
  const generations = useContext(GenerationsContext);
  if (!generations) throw new Error("Generations are not available. Wrap the screen in GenerationsProvider.");
  return generations;
}
