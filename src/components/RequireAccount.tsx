"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppLoading } from "./AppLoading";
import { useSession } from "../runtime/providers/SessionProvider";

/**
 * A screen a visitor may not open at all.
 *
 * The rest of the product degrades for somebody with no session — they see the
 * studios, the catalogue and the plans, and only the buttons that would spend
 * say "sign in". Two screens cannot degrade because they have no visitor-shaped
 * version: `/profile` is the balance and the history, `/gallery` is the work
 * itself. Both are the account or they are nothing.
 *
 * **A redirect, not a wall.** An earlier pass rendered a "this page is about
 * your account" panel in place of the screen. That is a page that opened and
 * then refused, which reads as an error the visitor caused — and it leaves them
 * on a route with nothing on it. Sending them to sign in with the destination
 * in hand answers the question instead of reporting it.
 *
 * `AppLoading` rather than the children while the redirect is in flight:
 * `router.replace` runs in an effect, so one frame always paints first, and
 * that frame must not be the guarded screen.
 */
export function RequireAccount({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const router = useRouter();

  useEffect(() => {
    /**
     * Home, not the sign-in screen.
     *
     * `?next=` was the first answer and it lost to a race it could not win: the
     * session also goes null when somebody presses "sign out", and `signOut`
     * navigates nowhere, so the guard fired on `/profile` and asked them to sign
     * in one frame after they asked to leave. Nothing in the component can tell
     * the two apart — the tree unmounts between them, so no ref survives — and
     * ordering the navigation ahead of the mutation does not help because the
     * route transition is async and the mutation resolves first.
     *
     * `/` is the answer for both. It is what "no access at all" means, and the
     * landing page's own bar is where the way in lives, so the visitor who
     * followed a link here is one click from where they were going.
     *
     * `replace`, never `push`: with a history entry behind it, Back returns to
     * the guarded route, which redirects again — the visitor is trapped.
     */
    if (!user) router.replace("/");
  }, [user, router]);

  if (!user) return <AppLoading />;
  return <>{children}</>;
}
