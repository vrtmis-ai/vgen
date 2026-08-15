"use client";

import { ClientRedirect } from "../../src/components/ClientRedirect";
import { navPath } from "../../src/runtime/router";

/**
 * `/` for a signed-in visitor.
 *
 * An anonymous visitor never gets here — the session gate in the layout above
 * returns the landing page for every path before children render.
 */
export default function HomePage() {
  return <ClientRedirect to={navPath("video")} />;
}
