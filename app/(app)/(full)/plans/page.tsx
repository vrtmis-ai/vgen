"use client";

import Plans from "../../../../src/screens/Plans";
import { useNavigation } from "../../../../src/runtime/providers/NavigationProvider";
import { useAuthedSession } from "../../../../src/runtime/providers/SessionProvider";

// Plans lays out its own 1100px container and turns its plan rows into grids
// above `md`. `currentPlanId` stays null until the backend can answer it — the
// screen renders the honest not-subscribed state meanwhile.
export default function PlansPage() {
  const { user, wallet } = useAuthedSession();
  const { goBack } = useNavigation();
  return <Plans wallet={wallet} account={user} currentPlanId={null} onBack={goBack} />;
}
