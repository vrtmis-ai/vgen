"use client";

import { useParams, useSearchParams } from "next/navigation";
import Result from "../../../../../src/screens/Result";
import { ClientRedirect } from "../../../../../src/components/ClientRedirect";
import { useGenerations } from "../../../../../src/runtime/providers/GenerationsProvider";
import { useNavigation } from "../../../../../src/runtime/providers/NavigationProvider";

// Result puts the media beside its actions above `md`.
export default function ResultPage() {
  const params = useParams<{ generationId: string }>();
  const searchParams = useSearchParams();
  const { gens, regenerate, markDone } = useGenerations();
  const { goBack, openModel } = useNavigation();

  const generation = gens.find((candidate) => candidate.id === decodeURIComponent(params.generationId));
  if (!generation) return <ClientRedirect to="/gallery" />;

  // Was router state, which App Router does not have. As a search param it also
  // survives a reload, so a refreshed result page no longer re-animates in.
  const instant = searchParams.get("instant") === "1";

  return (
    <Result
      key={generation.id}
      gen={generation}
      instant={instant}
      onBack={goBack}
      onRegenerate={() => void regenerate(generation)}
      onToVideo={() => openModel("seedance")}
      onDone={() => markDone(generation.id)}
    />
  );
}
