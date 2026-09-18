"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { variantControls, type Variant } from "../../data/models";
import type { InputMap, RefMap } from "../../components/controls";
import { loadGenerations, saveGenerations, uid, type GenStatus, type Generation } from "../../lib/gallery";
import { currentAspect } from "../../features/generation/aspect";
import { validateGenerationInput } from "../../features/generation/validation";
import { generationFromJob, mergeGenerations, sameGenerations } from "../../features/generation/fromJob";
import { useCatalogFamilies } from "../../features/catalog/CatalogProvider";
import { useCreateGeneration, useGalleryHistory, useGenerationJobs } from "../../features/generation/useGeneration";
import { SystemState } from "../../components/SystemState";
import { ApiError } from "../../adapters/http/client";
import type { GenerationQuote } from "../contracts/generation";
import { appQueryKeys } from "../../features/session/useSession";
import { useAppServices } from "../AppServices";
import { useIsVisitor } from "./SessionProvider";

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
  /**
   * Take one generation out of the account's history, here and on the server.
   *
   * Local-only would not hold: the wall is merged with `GET /gallery` on every
   * load, so a row dropped from this list walks straight back in on the next
   * read. Refused server-side while a job is still running, because its credits
   * are still held.
   */
  removeGeneration: (id: string) => Promise<void>;
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
  const visitor = useIsVisitor();
  const services = useAppServices();
  const createGeneration = useCreateGeneration();
  const queryClient = useQueryClient();
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

  /* The history, from the database rather than from this browser.
     `GET /api/v1/gallery` has worked since Phase H and nothing called it, so a
     gallery was only ever as complete as the one device that made it — sign in
     somewhere else and your work appeared to be gone.

     Folded into the same list rather than kept beside it, so everything
     downstream (the wall, a deep-linked result, the profile count, "to video")
     keeps reading one collection. What this browser started and the server has
     not answered about yet survives the fold; see `mergeGenerations`. */
  /* Both conditions, and the second one is the fix. This asked as soon as
     localStorage had been read, which is true for a visitor too — so every
     anonymous page load fired `GET /gallery` and collected a pair of 401s (a
     pair, because the query retries once). `useGalleryHistory`'s own comment
     already said it was gated "because an anonymous visitor has no history and
     the route would answer 401"; `hydrated` was simply the wrong boolean. */
  const history = useGalleryHistory(hydrated && !visitor);
  const historyItems = history.data?.items;
  useEffect(() => {
    if (!historyItems) return;
    const server = historyItems.map((job) => generationFromJob(job, families));
    setGens((previous) => {
      const merged = mergeGenerations(previous, server);
      // Same identity brake as the reconciliation effect below: this runs on
      // every render while the query has data, and a fresh array each time
      // would loop through the save effect and back.
      return sameGenerations(previous, merged) ? previous : merged;
    });
  }, [historyItems, families]);

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
      // A failed job is over and has no file, so both clauses below would have
      // matched it forever. It is asked about once, when it is still `running`
      // here and already `failed` on the server; after that there is nothing
      // left to learn.
      if (generation.status === "failed") return [];
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

  /* The coin counter, whenever a job moves.
   *
   * Credit moves twice per generation — a hold when it is submitted, a capture
   * or a release when it settles — and nothing was telling the wallet query
   * about either. `["wallet"]` was invalidated in exactly one place, on sign-in
   * (`useAuth`), so the balance in the header was whatever it had been when the
   * tab was opened: spend 1.3 coins on an image and the number kept saying what
   * it said before, until a full reload. `staleTime` is 15s, so even a refocus
   * inside that window did not correct it.
   *
   * Keyed on `jobStateKey`, which is the one string that already changes on
   * every transition this cares about, so a generation costs a handful of
   * `GET /wallet` calls and no polling at all. Deliberately not narrowed to
   * terminal states: the hold is the first thing a customer sees leave their
   * balance, and it happens on the first poll rather than at the end. */
  useEffect(() => {
    if (!jobStateKey) return;
    void queryClient.invalidateQueries({ queryKey: appQueryKeys.wallet });
  }, [jobStateKey, queryClient]);

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
        /* `succeeded` is the database's word and therefore the wire's; the
           stored Generation keeps a shorter one because a card only has three
           things to draw.

           This used to be `succeeded ? "done" : "running"`, which quietly made
           "failed" mean "still going". A job that a provider refuses settles in
           seconds, and the card it belongs to span for as long as the tab was
           open — the poll stops (the server calls it settled, so
           `refetchInterval` returns false) but nothing ever corrected the word.
           `cancelled` and `expired` join `failed`: all three are over, and all
           three end in a refund. */
        const status: GenStatus =
          job.status === "succeeded"
            ? "done"
            : job.status === "failed" || job.status === "cancelled" || job.status === "expired"
              ? "failed"
              : "running";
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
        // What the file actually is, rather than what was ordered. The server
        // measures this from the bytes; drawing the request's shape instead is
        // what leaves gradient bands along two edges. See `outW` in lib/gallery.
        const outW = output?.width ?? generation.outW;
        const outH = output?.height ?? generation.outH;
        const error = job.error ?? generation.error;
        if (
          generation.status === status &&
          generation.outputUrl === outputUrl &&
          generation.outputAssetId === outputAssetId &&
          generation.outputUrlExpiresAt === outputUrlExpiresAt &&
          generation.outW === outW &&
          generation.outH === outH &&
          generation.error === error
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
          ...(outW && outH ? { outW, outH } : {}),
          ...(error ? { error } : {}),
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
     through.

     It does not move the page. For a while it did — to کارهای من, the moment a
     job was accepted (#74) — because the new generation used to appear
     somewhere the customer was not looking and the button read as dead. That
     problem was real. Leaving the page was the wrong answer to it: the studio
     is a workbench, people send several in a row from one form, and a page
     change after every press threw them out of it. It also carried the button
     off screen before its field had finished drawing.

     So the studios answer on their own canvas now. The button lights, the job
     arrives first on the canvas as a running card, and a refusal lands in the
     same place with its reason. None of that needs anything from here beyond
     the job being in `gens`, which it is before this promise settles.

     A request that throws still takes over the screen below, as before. */
  const requestGeneration = useCallback(
    (familyId: string, prompt: string, input: InputMap, variant: Variant, options?: GenerationRequestOptions) => {
      void startGeneration(familyId, prompt, input, variant, options).catch((error: unknown) =>
        setOperationError(error instanceof Error ? error : new Error(String(error))),
      );
    },
    [startGeneration],
  );

  const removeGeneration = useCallback(
    async (id: string) => {
      const generation = gens.find((candidate) => candidate.id === id);
      if (!generation) return;
      /* The server first, then the list. The other order shows the row leaving
         and then puts it back when the request is refused — and the one refusal
         this has is "that job is still running", which is exactly the case
         where the customer must not be told it is gone. */
      if (generation.jobId) {
        await services.generation.remove(generation.jobId);
        // The history query holds a page that still contains it, and the merge
        // effect runs off that page. Without this the row returns on the next
        // render rather than on the next reload.
        await queryClient.invalidateQueries({ queryKey: ["gallery-history"] });
      }
      setGens((previous) => previous.filter((candidate) => candidate.id !== id));
    },
    [gens, queryClient, services],
  );

  const markDone = useCallback((id: string) => {
    setGens((previous) => previous.map((generation) => (generation.id === id ? { ...generation, status: "done" } : generation)));
  }, []);

  const value = useMemo<Generations>(
    () => ({ gens, hydrated, startGeneration, requestGeneration, removeGeneration, markDone }),
    [gens, hydrated, markDone, removeGeneration, requestGeneration, startGeneration],
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
