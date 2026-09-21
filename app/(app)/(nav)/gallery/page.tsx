"use client";

import Gallery from "../../../../src/screens/Gallery";
import { RequireAccount } from "../../../../src/components/RequireAccount";
import { useGenerations } from "../../../../src/runtime/providers/GenerationsProvider";
import { useNavigation } from "../../../../src/runtime/providers/NavigationProvider";

/**
 * کارهای من — the visitor's own work, so there is nothing to show somebody who
 * has none. Guarded rather than rendered empty: an empty gallery tells a
 * signed-out visitor the product produced nothing for them, which is a lie
 * about the product rather than a fact about their session.
 */
export default function GalleryPage() {
  return (
    <RequireAccount>
      <GalleryScreen />
    </RequireAccount>
  );
}

function GalleryScreen() {
  const { gens, removeGeneration, cancelGeneration, regenerate } = useGenerations();
  const { openResult, setTab, openModel } = useNavigation();

  return (
    <Gallery
      gens={gens}
      onOpen={(generation) => openResult(generation.id, { instant: true })}
      onRemove={(generation) => void removeGeneration(generation.id)}
      onCancel={cancelGeneration ? (generation) => cancelGeneration(generation.id) : undefined}
      onRegenerate={(generation) => void regenerate(generation)}
      onToVideo={(generation) => openModel("seedance", generation.prompt, generation.id)}
      onBrowse={() => setTab("video")}
    />
  );
}
