"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultInput, variantControls, type Variant } from "../../data/models";
import type { InputMap, RefMap } from "../../components/controls";
import { loadGenerations, saveGenerations, uid, type GenStatus, type Generation } from "../../lib/gallery";
import { currentAspect } from "../../features/generation/aspect";
import { validateGenerationInput } from "../../features/generation/validation";
import { useCatalogFamilies } from "../../features/catalog/CatalogProvider";
import { useCreateGeneration, useGenerationJobs } from "../../features/generation/useGeneration";
import { SystemState } from "../../components/SystemState";
import { ApiError } from "../../adapters/http/client";
import type { GenerationQuote } from "../contracts/generation";
import { useAppServices } from "../AppServices";
import { useNavigation } from "./NavigationProvider";

interface StartedGeneration {
  generation: Generation;
  quote: GenerationQuote;
}

/**
 * The parts of a generation request that are optional at the call site.
 *
 * A bag rather than two more positional parameters. `startGeneration` already
 * took four before this, and a dock that wants to send references *and* decline
 * the free pipe would make it six — at which point the two booleans-shaped
 * arguments next to each other are a bug waiting for somebody in a hurry.
 *
 * Both fields are genuinely optional and mean different things when absent:
 * no `refs` is a generation with no attachments, while no `preferUnlimited` is
 * "decide for me", which the server reads as the grant applying if it is held.
 */
export interface GenerationRequestOptions {
  /** Files picked per reference slot. Uploaded before the quote — see below. */
  refs?: RefMap;
  /**
   * `false` declines a free grant this account holds and pays for the quicker
   * queue. Absent leaves the choice to the server, which is what every caller
   * wanted before there was a switch to say otherwise.
   */
  preferUnlimited?: boolean;
  /**
   * Files already in our store, by slot — the account's own finished work being
   * fed back in, rather than something picked off a disk.
   *
   * Separate from `refs` because there is nothing to upload: "to video" hands a
   * finished image to a video model, and those bytes are already here under an
   * asset id the quote endpoint accepts. Merged with the ids the uploads
   * produce, so a slot can hold both.
   */
  assetRefs?: Record<string, string[]>;
}

interface Generations {
  gens: Generation[];
  /**
   * Whether `gens` has been read back from localStorage yet.
   *
   * It starts empty on both server and client and fills in an effect, so for
   * one render "this account has no generations" and "we have not looked yet"
   * are the same value. A screen that redirects on an empty list has to tell
   * them apart: the result page did not, so opening or refreshing a result URL
   * bounced to the gallery every time, before the generation it names had any
   * chance to load.
   */
  hydrated: boolean;
  startGeneration: (
    familyId: string,
    prompt: string,
    input: InputMap,
    variant: Variant,
    options?: GenerationRequestOptions,
  ) => Promise<StartedGeneration | null>;
  /** Fire-and-forget start used by the studio docks, which have no result to await. */
  requestGeneration: (familyId: string, prompt: string, input: InputMap, variant: Variant, options?: GenerationRequestOptions) => void;
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
  const services = useAppServices();
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

  /* Which jobs to ask about. Running ones, obviously — plus two kinds of
     finished one that need a fresh answer.

     A job whose asset id we never wrote down. That is every generation made
     before `outputAssetId` existed, and they are exactly the ones somebody
     would press "to video" on first; without this the button on their existing
     work would carry nothing.

     A job whose URL has expired, or is about to. Output URLs are signed for an
     hour and this list is kept in localStorage forever, so an untouched gallery
     turned into a wall of broken images at the sixty-minute mark — the files
     were fine, the signatures were not, and nothing ever asked for new ones.
     `urlsExpireAt` has been on the wire the whole time with no reader.

     None of this can become a polling loop: `useGenerationJobs` returns `false`
     from `refetchInterval` for anything not queued or running, so a finished
     job is fetched once per session and never again, even if the fetch somehow
     fails to satisfy the condition that selected it.

     It refreshes when this list changes rather than on a timer, so a tab left
     open for an hour still has to be touched before its pictures come back.
     That is the cheap 90%: opening or navigating to the gallery re-signs. */
  const runningJobIds = useMemo(() => {
    // A margin, so a URL that dies while the page is being read is replaced
    // before it does rather than after.
    const soon = Date.now() + 2 * 60 * 1000;
    return gens.flatMap((generation) => {
      if (!generation.jobId) return [];
      if (generation.status === "running" || !generation.outputAssetId) return [generation.jobId];
      // An output with no recorded expiry predates that field, so its age is
      // unknown and the safe reading is "assume it has gone".
      if (generation.outputUrl && (generation.outputUrlExpiresAt ?? 0) < soon) return [generation.jobId];
      return [];
    });
  }, [gens]);
  const jobQueries = useGenerationJobs(runningJobIds);
  // No progress percentage in the key any more: nothing on the server produces
  // one. A job is queued, running, or over — and the outputs arriving is what
  // marks the end, which is why they are part of the key.
  const jobStateKey = jobQueries.jobs.map((job) => `${job.id}:${job.status}:${job.outputs.length}`).join("|");
  useEffect(() => {
    if (!jobStateKey) return;
    const byId = new Map(jobQueries.jobs.map((job) => [job.id, job]));
    setGens((previous) => {
      /* Returning `previous` untouched when nothing moved is load-bearing, not
         tidiness. `useQueries` hands back a fresh array every render, so this
         effect runs on every render; if it always built a new array React would
         re-render, the effect would run again, and the two would chase each
         other until React gave up with "Maximum update depth exceeded". Object
         identity is the brake. */
      let changed = false;
      const next = previous.map((generation) => {
        const job = generation.jobId ? byId.get(generation.jobId) : undefined;
        if (!job) return generation;
        // `succeeded` is the database's word and therefore the wire's. The
        // stored Generation keeps its own two-state vocabulary because that is
        // all a card renders.
        const status: GenStatus = job.status === "succeeded" ? "done" : "running";
        const output = job.outputs[0];
        const outputUrl = output?.url ?? generation.outputUrl;
        // Kept alongside the URL because the URL cannot be kept: it is signed
        // and expires, while the asset id is how the next generation names this
        // file as an input. See `outputAssetId` in lib/gallery.
        const outputAssetId = output?.assetId ?? generation.outputAssetId;
        // Kept with the URL it applies to. Stored only when a URL came back in
        // this response, so a re-read that produced nothing cannot leave a
        // fresh expiry sitting next to a stale link.
        const outputUrlExpiresAt = output?.url ? (job.urlsExpireAt ?? undefined) : generation.outputUrlExpiresAt;
        if (
          generation.status === status &&
          generation.outputUrl === outputUrl &&
          generation.outputAssetId === outputAssetId &&
          generation.outputUrlExpiresAt === outputUrlExpiresAt
        ) {
          return generation;
        }
        changed = true;
        return {
          ...generation,
          status,
          ...(outputUrl ? { outputUrl } : {}),
          ...(outputAssetId ? { outputAssetId } : {}),
          ...(outputUrlExpiresAt ? { outputUrlExpiresAt } : {}),
        };
      });
      return changed ? next : previous;
    });
  }, [jobQueries.jobs, jobStateKey]);

  const startGeneration = useCallback(
    async (familyId: string, prompt: string, input: InputMap, variant: Variant, options: GenerationRequestOptions = {}) => {
      const refs = options.refs ?? {};
      const family = families.find((candidate) => candidate.id === familyId);
      const catalogVariant = family?.variants.find((candidate) => candidate.id === variant.id);
      if (!family || !catalogVariant) return null;
      if (!validateGenerationInput({ family, variant, prompt, input, refs, assetRefs: options.assetRefs }).valid) return null;
      if (pendingRef.current) return null;
      const aspect = currentAspect(variantControls(family, variant), input);
      pendingRef.current = true;
      try {
        /* References go up before the quote, because the quote names them by id
           and the server prices some models off what was actually uploaded.
           A slot holds an ordered list and the order is meaningful — first and
           last frame are two entries in one slot on several video models — so
           each slot's uploads are awaited together and kept in place.

           A failed upload aborts the whole generation rather than quoting
           without that reference: a first-frame model handed no first frame
           does not fail, it silently makes something else and charges for it. */
        const slots = Object.entries(refs).filter(([, files]) => files.length > 0);
        const uploaded = await Promise.all(
          slots.map(
            async ([slot, files]) => [slot, await Promise.all(files.map(async (f) => (await services.assets.upload(f.file)).id))] as const,
          ),
        );
        /* Uploads and already-stored assets land in the same map, per slot.
           Concatenated rather than merged by key replacement: a slot holds an
           ordered list and "to video" fills the first entry, so a user who then
           attaches a second image is adding to it, not replacing it. */
        const referenceAssetIds: Record<string, string[]> = { ...(options.assetRefs ?? {}) };
        for (const [slot, ids] of uploaded) referenceAssetIds[slot] = [...(referenceAssetIds[slot] ?? []), ...ids];

        const { job, quote } = await createGeneration.mutateAsync({
          quote: {
            familyId,
            variantId: variant.id,
            prompt,
            input,
            referenceAssetIds,
            // Spread rather than passed as `undefined`, so a caller with no
            // opinion sends no field at all and the server's own default
            // decides. Sending an explicit `undefined` would be the same on
            // the wire, but this way the intent is readable here.
            ...(options.preferUnlimited === undefined ? {} : { preferUnlimited: options.preferUnlimited }),
          },
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

  /* The studios' start button, and the one place all three of them route
     through — so it is the one place that has to answer "what just happened".

     It used to answer nothing. The job was submitted, the coins were held, and
     the page did not move: the new generation appeared as a tile somewhere in
     the canvas the user was not necessarily looking at, and on the video studio
     it is below a 320px form panel. Pressing a button that costs money and
     watching the screen stay exactly as it was reads as a dead button, and it
     was reported as one.

     So it goes where the work is. `setTab("gallery")` rather than the result
     page: the studios are where people submit several in a row, and کارهای من
     is the screen that holds all of them with their progress — landing on one
     result would hide the other four.

     Only on success. A refusal has an error to show and moving the page would
     take the user away from the form that produced it. */
  const requestGeneration = useCallback(
    (familyId: string, prompt: string, input: InputMap, variant: Variant, options?: GenerationRequestOptions) => {
      void startGeneration(familyId, prompt, input, variant, options)
        .then((started) => {
          if (started) navigation.setTab("gallery");
        })
        .catch((error: unknown) => setOperationError(error instanceof Error ? error : new Error(String(error))));
    },
    [navigation, startGeneration],
  );

  const regenerate = useCallback(
    async (previous: Generation) => {
      const family = families.find((candidate) => candidate.id === previous.familyId);
      const variant = family?.variants.find((candidate) => candidate.id === previous.variantId);
      if (!family || !variant) return;
      // No options: a regeneration repeats the prompt and the controls, not the
      // attachments, and it leaves the free-pipe decision to the server exactly
      // as the original did.
      const started = await startGeneration(family.id, previous.prompt, defaultInput(variantControls(family, variant)), variant);
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
    () => ({ gens, hydrated, startGeneration, requestGeneration, regenerate, markDone }),
    [gens, hydrated, markDone, regenerate, requestGeneration, startGeneration],
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
