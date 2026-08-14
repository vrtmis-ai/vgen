"use client";

import Academy from "../../../../src/screens/Academy";
import { useNavigation } from "../../../../src/runtime/providers/NavigationProvider";

export default function AcademyPage() {
  const { openModel } = useNavigation();
  return <Academy onOpenModel={openModel} />;
}
