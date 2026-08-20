"use client";

import { AdminConsole } from "../../src/screens/admin/AdminConsole";

/**
 * Staff furniture, reached by typing /admin. Deliberately not in the top bar —
 * a nav item would sit in front of every customer forever to save four people
 * one bookmark.
 *
 * Outside the `(app)` route group on purpose. That group's layout gates on a
 * *customer* session and will not paint until the wallet, the catalogue and the
 * content have loaded — none of which a staff session has or needs. An admin
 * signing in to fix a broken route should not first have to be a customer.
 */
export default function AdminPage() {
  return <AdminConsole />;
}
