"use client";

import { useParams, useSearchParams } from "next/navigation";
import Generate from "../../../../../src/screens/Generate";
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

  return (
    <Generate
      family={family}
      initialPrompt={initialPrompt}
      startFrom={startFrom}
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
