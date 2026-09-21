"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Generate, { type CarriedRef, type Reuse } from "../../../../../src/screens/Generate";
import { useAppServices } from "../../../../../src/runtime/AppServices";
import { ClientRedirect } from "../../../../../src/components/ClientRedirect";
import { useCatalogFamilies } from "../../../../../src/features/catalog/CatalogProvider";
import { useGenerations } from "../../../../../src/runtime/providers/GenerationsProvider";
import { useNavigation } from "../../../../../src/runtime/providers/NavigationProvider";
import { navPath } from "../../../../../src/runtime/router";

// Generate lays out its own dock and canvas, as the studios do.
export default function GeneratePage() {
  const params = useParams<{ familyId: string }>();
  const searchParams = useSearchParams();
  const families = useCatalogFamilies();
  const { gens, startGeneration, removeGeneration, cancelGeneration, regenerate } = useGenerations();
  const { goBack, openResult, openWallet, openModel } = useNavigation();

  /* "Generate again" arrives as `?again=<generation id>`, and what it restores
     is the *inputs* of that generation rather than its output. The settings
     ride along on the row the gallery already holds; the files do not, because
     a reference URL is signed and expires, so they are fetched by id from the
     one route that can prove this account owns them.

     Above the redirect below, because it calls a hook: an early return between
     two hooks changes how many run on a render, which React reads as the hooks
     having moved. */
  const again = gens.find((candidate) => candidate.id === searchParams.get("again"));
  const references = useJobReferences(again?.jobId);

  const family = families.find((candidate) => candidate.id === decodeURIComponent(params.familyId));
  if (!family) return <ClientRedirect to={navPath("video")} />;

  const initialPrompt = searchParams.get("prompt") ?? undefined;

  /* "To video" arrives here as `?from=<generation id>`, and the file it means
     is looked up in the list this page already holds rather than passed through
     the URL — a signed link is hundreds of characters and expires.

     Both halves are required: `outputAssetId` is what the quote will accept,
     `outputUrl` is what the user sees so they can tell it is the right frame.
     A generation still running has neither, and silently opening an empty form
     would be the bug this replaced. */
  const source = gens.find((candidate) => candidate.id === searchParams.get("from"));
  const startFrom =
    source?.outputAssetId && source.outputUrl ? { assetId: source.outputAssetId, url: source.outputUrl, kind: source.kind } : undefined;

  const reuse: Reuse | undefined = again
    ? {
        jobId: again.id,
        variantId: again.variantId,
        // The prompt lives in `params` too, and the form has its own field for
        // it — leaving it in would put the prompt into a settings control.
        input: Object.fromEntries(Object.entries(again.params ?? {}).filter(([key]) => key !== "prompt")) as Reuse["input"],
        references,
      }
    : undefined;

  return (
    <Generate
      family={family}
      initialPrompt={again ? again.prompt : initialPrompt}
      initialVariantId={again?.variantId}
      startFrom={startFrom}
      reuse={reuse}
      onBack={goBack}
      /* The whole list, so the canvas beside the dock can draw this model's
         own work — including what was made here a moment ago, which keeps its
         live state as the jobs poll. */
      gens={gens}
      onOpen={(generation) => openResult(generation.id, { instant: generation.status !== "running" })}
      onRemove={(generation) => void removeGeneration(generation.id)}
      onCancel={cancelGeneration ? (generation) => cancelGeneration(generation.id) : undefined}
      onRegenerate={(generation) => void regenerate(generation)}
      /* Carries the picture, not just the destination — as the result page's
         own button does. */
      onToVideo={(generation) => openModel("seedance", generation.prompt, generation.id)}
      /* The wallet and the plan ladder are two sections of the same page today;
         see the studios. */
      onErrorAction={() => openWallet()}
      onGenerate={async (prompt, input, variant, refs, assetRefs) => {
        const started = await startGeneration(family.id, prompt, input, variant, { refs, assetRefs });
        /* The page stays. It used to leave for کارهای من here, the studios'
           destination at the time, because a form with a line of receipt text
           under its button read as nothing having happened. The job now lands
           on the canvas beside the dock instead — so the next variation can be
           sent from the settings that are still on screen. */
        return started ? { coins: started.quote.coins, expiresAt: started.quote.expiresAt } : null;
      }}
    />
  );
}

/**
 * The files a past generation ran against, signed for preview.
 *
 * Empty until it answers, and empty for a generation this browser started but
 * the server has not confirmed — which is correct rather than a gap: a job with
 * no id on the server has no stored references to restore.
 */
function useJobReferences(jobId: string | undefined): CarriedRef[] {
  const services = useAppServices();
  const [references, setReferences] = useState<CarriedRef[]>([]);

  useEffect(() => {
    if (!jobId) {
      setReferences([]);
      return;
    }
    const abort = new AbortController();
    void services.generation
      .references(jobId, { signal: abort.signal })
      .then((found) =>
        setReferences(
          found.map((reference) => ({
            slot: reference.slot,
            assetId: reference.assetId,
            url: reference.url,
            kind: reference.kind,
            label: "از تولید قبلی",
          })),
        ),
      )
      // A reference we cannot show is not a reason to refuse the whole form:
      // the prompt and the settings are still worth arriving with, and the
      // slot simply reads as empty.
      .catch(() => undefined);
    return () => abort.abort();
  }, [jobId, services]);

  return references;
}
