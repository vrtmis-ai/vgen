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
  const { startGeneration } = useGenerations();
  const { goBack } = useNavigation();

  const family = families.find((candidate) => candidate.id === decodeURIComponent(params.familyId));
  if (!family) return <ClientRedirect to={navPath("video")} />;

  const initialPrompt = searchParams.get("prompt") ?? undefined;

  return (
    <Generate
      family={family}
      initialPrompt={initialPrompt}
      onBack={goBack}
      onGenerate={async (prompt, input, variant, refs) => {
        const started = await startGeneration(family.id, prompt, input, variant, { refs });
        return started ? { coins: started.quote.coins, expiresAt: started.quote.expiresAt } : null;
      }}
    />
  );
}
