"use client";

import Community from "../../../../src/screens/Community";
import { useNavigation } from "../../../../src/runtime/providers/NavigationProvider";

export default function CommunityPage() {
  const { openModel } = useNavigation();
  return <Community onOpen={openModel} />;
}
