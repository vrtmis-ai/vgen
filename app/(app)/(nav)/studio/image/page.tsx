"use client";

import StudioImage from "../../../../../src/screens/StudioImage";
import { useGenerations } from "../../../../../src/runtime/providers/GenerationsProvider";
import { useNavigation } from "../../../../../src/runtime/providers/NavigationProvider";

export default function StudioImagePage() {
  const { gens, requestGeneration } = useGenerations();
  const { openModel } = useNavigation();

  return (
    <StudioImage
      gens={gens}
      onGenerate={(family, variant, prompt, input, preferUnlimited) => requestGeneration(family.id, prompt, input, variant, { preferUnlimited })}
      onOpenModel={openModel}
    />
  );
}
