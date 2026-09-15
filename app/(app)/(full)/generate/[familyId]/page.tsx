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

// Generate lays out its own 1100px two-column grid above `md`.
export default function GeneratePage() {
  const params = useParams<{ familyId: string }>();
  const searchParams = useSearchParams();
  const families = useCatalogFamilies();
  const { gens, startGeneration } = useGenerations();
  const { goBack, setTab } = useNavigation();

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
      onGenerate={async (prompt, input, variant, refs, assetRefs) => {
        const started = await startGeneration(family.id, prompt, input, variant, { refs, assetRefs });
        /* Same destination as the studios, for the same reason: the job is
           away, the coins are held, and leaving the form on screen with a line
           of receipt text under the button reads as nothing having happened.
           کارهای من is where the generation now is, with its progress on it.

           Only on success — a refusal has an error to show, and moving the page
           would take the user away from the form that produced it. */
        if (started) setTab("gallery");
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
