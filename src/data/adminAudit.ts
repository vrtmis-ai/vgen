import { useSyncExternalStore } from "react";

/* ---------------------------------------------------------------------------
   The money ledger.

   docs/admin.md §4 lists three things that cannot be added later, and this is
   the second: every credit grant and every refund, with who did it, how much,
   why, and when. It cannot be reconstructed after the fact — if it is not
   written at the moment of the act, the answer to "who gave this account 500
   coins" is gone.

   So it exists now, before there is a backend to write to and before anything
   can actually move money. Today it records what the panel does locally; when
   the API lands it is the same shape, appended server-side, and the panel reads
   it instead of owning it.

   Deliberately append-only with no delete: a ledger you can edit is not one.
   --------------------------------------------------------------------------- */

export type AuditKind = "grant" | "refund" | "price" | "role";

export interface AuditEntry {
  id: string;
  kind: AuditKind;
  /** The admin account that did it. */
  by: string;
  /** Who or what it was done to — an account id, a plan id, a job id. */
  target: string;
  /** Coins for grant/refund; absent for the rest. */
  amount?: number;
  /** Required by the panel, not optional: an unexplained grant is the thing
   *  this ledger exists to make impossible. */
  reason: string;
  at: number;
}

const KEY = "vgen:admin-audit";

let entries: AuditEntry[] = load();
let version = 0;
const subs = new Set<() => void>();

function load(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function commit() {
  version++;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* see contentStore: the entry still holds for this session */
  }
  subs.forEach((f) => f());
}

export function record(e: Omit<AuditEntry, "id" | "at">) {
  entries = [{ ...e, id: `a${Date.now()}${Math.random().toString(36).slice(2, 6)}`, at: Date.now() }, ...entries];
  commit();
}

export function useAudit(): AuditEntry[] {
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
    () => version,
  );
  return entries;
}
