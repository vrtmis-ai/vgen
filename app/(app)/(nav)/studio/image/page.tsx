"use client";

import StudioImage from "../../../../../src/screens/StudioImage";
import { useGenerations } from "../../../../../src/runtime/providers/GenerationsProvider";
import { useNavigation } from "../../../../../src/runtime/providers/NavigationProvider";

export default function StudioImagePage() {
  const { gens, requestGeneration, removeGeneration, submitError } = useGenerations();
  const { openModel, openWallet } = useNavigation();

  return (
    <StudioImage
      gens={gens}
      onGenerate={(family, variant, prompt, input, preferUnlimited, refs) =>
        requestGeneration(family.id, prompt, input, variant, { preferUnlimited, refs })
      }
      onOpenModel={openModel}
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
