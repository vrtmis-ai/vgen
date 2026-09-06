"use client";

import Landing from "../../src/screens/Landing";
import { AppLoading } from "../../src/components/AppLoading";
import { useCommunityFeed, usePlans } from "../../src/features/session/useSession";
import { useNavigation } from "../../src/runtime/providers/NavigationProvider";

/**
 * `/` for a signed-in visitor: the landing page, same as everyone else sees.
 *
 * This used to redirect straight to the video studio, which meant an account
 * holder had no way to reach the front of their own site — the wordmark, the
 * one control on every screen that says "take me back to the start", had
 * nowhere to send them. So it pointed at the Explore tab instead, and the
 * landing page was unreachable the moment you signed in.
 *
 * It sits outside the (nav) group deliberately: the landing page carries its own
 * sticky header, and the app's top bar above it would be a second one. That
 * header is where the wordmark lives on this page, and pressing it scrolls to
 * the top rather than navigating — the same gesture the top bar's wordmark
 * performs everywhere else.
 *
 * `usePlans`/`useCommunityFeed` are the same queries the layout above already
 * ran, so this reads their cache rather than fetching anything again.
 */
export default function HomePage() {
  const plansQuery = usePlans();
  const communityQuery = useCommunityFeed();
  const { setTab } = useNavigation();

  if (!plansQuery.data) return <AppLoading />;

  return (
    <Landing
      plans={plansQuery.data}
      // An empty showcase strip is a much smaller failure than a landing page
      // that refuses to paint until other people's posts have loaded.
      posts={communityQuery.data?.posts ?? []}
      // Both calls to action are "sign in" for a visitor. Somebody already
      // signed in wants the thing behind them, so they open the studio rather
      // than an auth screen that would have nothing to ask.
      signedIn
      onSignIn={() => setTab("video")}
      onSignUp={() => setTab("video")}
    />
  );
}
