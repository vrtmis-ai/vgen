"use client";

import Profile from "../../../../src/screens/Profile";
import { RequireAccount } from "../../../../src/components/RequireAccount";
import { useGenerations } from "../../../../src/runtime/providers/GenerationsProvider";
import { useNavigation } from "../../../../src/runtime/providers/NavigationProvider";
import { useAuthedSession } from "../../../../src/runtime/providers/SessionProvider";

/**
 * Profile lays out its own 900px two-column grid above `md`.
 *
 * The one screen there is no visitor version of: it is entirely about an
 * account — the balance, the history, the sign-out. Everywhere else in the
 * product degrades instead. `RequireAccount` sends a visitor to sign in with
 * this route in hand; it never renders the screen and then apologises.
 *
 * Split in two so the guard is a real boundary. `useAuthedSession` throws
 * without an account by design, and a single component would call it on the
 * visitor's render — before the redirect it is wrapped in could ever run.
 */
export default function ProfilePage() {
  return (
    <RequireAccount>
      <ProfileScreen />
    </RequireAccount>
  );
}

function ProfileScreen() {
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
