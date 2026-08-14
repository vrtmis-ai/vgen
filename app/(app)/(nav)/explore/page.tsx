"use client";

import Explore from "../../../../src/screens/Explore";
import { useNavigation } from "../../../../src/runtime/providers/NavigationProvider";

export default function ExplorePage() {
  const { openModel, setTab, openWallet } = useNavigation();
  return <Explore onOpen={openModel} onNav={setTab} onWallet={openWallet} />;
}
