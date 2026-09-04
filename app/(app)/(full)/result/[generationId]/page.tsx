"use client";

import { useParams, useSearchParams } from "next/navigation";
import Result from "../../../../../src/screens/Result";
import { AppLoading } from "../../../../../src/components/AppLoading";
import { ClientRedirect } from "../../../../../src/components/ClientRedirect";
import { useGenerations } from "../../../../../src/runtime/providers/GenerationsProvider";
import { useNavigation } from "../../../../../src/runtime/providers/NavigationProvider";

// Result puts the media beside its actions above `md`.
export default function ResultPage() {
  const params = useParams<{ generationId: string }>();
  const searchParams = useSearchParams();
  const { gens, hydrated, regenerate, markDone } = useGenerations();
  const { goBack, openModel } = useNavigation();

  const generation = gens.find((candidate) => candidate.id === decodeURIComponent(params.generationId));
  /* Wait before giving up. The list arrives from localStorage in an effect, so
     the first render of a cold load has none — and redirecting on that render
     meant opening or refreshing a result link always bounced to the gallery,
     however real the generation was. Only an empty list we have actually
     looked at means "no such generation". */
  if (!generation) return hydrated ? <ClientRedirect to="/gallery" /> : <AppLoading />;

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
      /* Carries the picture, not just the destination. This opened the video
         model with an empty form, so "to video" on a finished image meant
         "start again, from nothing" — the image the button is attached to was
         dropped on the way. */
      onToVideo={() => openModel("seedance", generation.prompt, generation.id)}
      onDone={() => markDone(generation.id)}
    />
  );
}
