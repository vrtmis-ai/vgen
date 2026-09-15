"use client";

import StudioImage from "../../../../../src/screens/StudioImage";
import { useGenerations } from "../../../../../src/runtime/providers/GenerationsProvider";
import { useNavigation } from "../../../../../src/runtime/providers/NavigationProvider";

export default function StudioImagePage() {
  const { gens, requestGeneration, removeGeneration } = useGenerations();
  const { openModel } = useNavigation();

  return (
    <StudioImage
      gens={gens}
      onGenerate={(family, variant, prompt, input, preferUnlimited, refs) =>
        requestGeneration(family.id, prompt, input, variant, { preferUnlimited, refs })
      }
      onOpenModel={openModel}
      onRemove={(generation) => void removeGeneration(generation.id)}
    />
  );
}
