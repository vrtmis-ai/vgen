"use client";

import StudioAudio from "../../../../../src/screens/StudioAudio";
import { useGenerations } from "../../../../../src/runtime/providers/GenerationsProvider";

export default function StudioAudioPage() {
  const { gens, requestGeneration } = useGenerations();

  return (
    <StudioAudio gens={gens} onGenerate={(family, variant, prompt, input) => requestGeneration(family.id, prompt, input, variant)} />
  );
}
