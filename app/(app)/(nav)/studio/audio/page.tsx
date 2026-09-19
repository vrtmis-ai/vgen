"use client";

import StudioAudio from "../../../../../src/screens/StudioAudio";
import { useGenerations } from "../../../../../src/runtime/providers/GenerationsProvider";
import { useNavigation } from "../../../../../src/runtime/providers/NavigationProvider";

export default function StudioAudioPage() {
  const { gens, requestGeneration, removeGeneration, submitError } = useGenerations();
  const { openWallet } = useNavigation();

  return (
    <StudioAudio
      gens={gens}
      onGenerate={(family, variant, prompt, input) => requestGeneration(family.id, prompt, input, variant)}
      onRemove={(generation) => void removeGeneration(generation.id)}
      /* Both refusals with a way out end at the same page: the wallet and the
         plan ladder are two sections of /plans. Kept as two targets anyway,
         because the notice's label promises different things and the day they
         split, the screens will not need touching. */
      submitError={submitError}
      onErrorAction={() => openWallet()}
    />
  );
}
