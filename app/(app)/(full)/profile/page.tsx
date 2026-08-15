"use client";

import Profile from "../../../../src/screens/Profile";
import { useGenerations } from "../../../../src/runtime/providers/GenerationsProvider";
import { useNavigation } from "../../../../src/runtime/providers/NavigationProvider";
import { useAuthedSession } from "../../../../src/runtime/providers/SessionProvider";

// Profile lays out its own 900px two-column grid above `md`.
export default function ProfilePage() {
  const { user, wallet, signOut } = useAuthedSession();
  const { gens } = useGenerations();
  const { openWallet, openModel, goBack } = useNavigation();

  return (
    <Profile
      account={user}
      wallet={wallet}
      gens={gens}
      onWallet={openWallet}
      onGallery={goBack}
      onOpenModel={openModel}
      onSignOut={signOut}
    />
  );
}
