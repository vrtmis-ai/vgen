"use client";

import Effects from "../../../../src/screens/Effects";
import { useNavigation } from "../../../../src/runtime/providers/NavigationProvider";

export default function EffectsPage() {
  const { openModel } = useNavigation();
  return <Effects onOpen={openModel} />;
}
