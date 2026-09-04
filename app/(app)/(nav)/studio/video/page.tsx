"use client";

import Studio from "../../../../../src/screens/Studio";
import { useGenerations } from "../../../../../src/runtime/providers/GenerationsProvider";
import { useNavigation } from "../../../../../src/runtime/providers/NavigationProvider";

/* One screen per modality, not one screen parameterised by modality. The
   reference gives image, video and audio genuinely different architectures — a
   full-bleed wall under a floating glass dock, a 320px side panel, and an icon
   rail over waveform cards — because the three kinds of output are shaped
   differently. They share the token layer and `useCreateState`, and nothing else. */
export default function StudioVideoPage() {
  const { gens, requestGeneration } = useGenerations();
  const { openResult } = useNavigation();

  return (
    <Studio
      kind="video"
      gens={gens}
      onGenerate={(family, variant, prompt, input, refs) => requestGeneration(family.id, prompt, input, variant, { refs })}
      onOpen={(generation) => openResult(generation.id, { instant: true })}
    />
  );
}
