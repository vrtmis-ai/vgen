"use client";

import Admin from "../../../../src/screens/Admin";
import { useNavigation } from "../../../../src/runtime/providers/NavigationProvider";

/* Not in the top bar, and that is deliberate — it is staff furniture, and a nav
   item for it would sit in front of every customer forever to save four people
   one bookmark. Reached by typing /admin.

   ⚠️ Still unauthenticated. That is safe only for exactly as long as every write
   lands in the operator's own localStorage, which is true today and stops being
   true the moment this panel talks to the admin API. The admin-auth phase gates
   this route before any write leaves the browser. */
export default function AdminPage() {
  const { goBack } = useNavigation();
  return <Admin onBack={goBack} />;
}
