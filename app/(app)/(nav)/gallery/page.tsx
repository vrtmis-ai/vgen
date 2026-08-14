"use client";

import Gallery from "../../../../src/screens/Gallery";
import { useGenerations } from "../../../../src/runtime/providers/GenerationsProvider";
import { useNavigation } from "../../../../src/runtime/providers/NavigationProvider";

export default function GalleryPage() {
  const { gens } = useGenerations();
  const { openResult, setTab } = useNavigation();

  return <Gallery gens={gens} onOpen={(generation) => openResult(generation.id, { instant: true })} onBrowse={() => setTab("video")} />;
}
