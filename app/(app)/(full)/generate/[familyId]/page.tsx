"use client";

import { useState } from "react";
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
  const { gens, startGeneration, removeGeneration } = useGenerations();
  const { goBack, openResult } = useNavigation();
  // The generations sent from this page, newest first, by the id `gens` keeps.
  const [sentHere, setSentHere] = useState<string[]>([]);

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
      /* Looked up in `gens` on every render, so each one keeps its live state —
         running, refused, or there — as the jobs poll. A removed one drops out
         the same way. */
      made={sentHere.flatMap((id) => gens.filter((generation) => generation.id === id))}
      onOpenMade={(generation) => openResult(generation.id, { instant: generation.status !== "running" })}
      onRemoveMade={(generation) => void removeGeneration(generation.id)}
      onGenerate={async (prompt, input, variant, refs, assetRefs) => {
        const started = await startGeneration(family.id, prompt, input, variant, { refs, assetRefs });
        /* The page stays. It used to leave for کارهای من here, the studios'
           destination at the time, because a form with a line of receipt text
           under its button read as nothing having happened. The job is now drawn
           on this page instead, above the form — so the next variation can be
           sent from the settings that are still on screen. */
        if (started) setSentHere((ids) => [started.generation.id, ...ids]);
        return started ? { coins: started.quote.coins, expiresAt: started.quote.expiresAt } : null;
      }}
    />
  );
}
