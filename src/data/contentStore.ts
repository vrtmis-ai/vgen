import { useSyncExternalStore } from "react";
import { published, type ContentRecord } from "./content";

/* ---------------------------------------------------------------------------
   Where the admin's edits live until there is a backend to hold them.

   The seeded collections in data/ are the shipped defaults and stay immutable —
   they are the fallback if storage is cleared, and they are what a fresh browser
   sees. This holds a patch per record id on top of them.

   That layering is the point. An admin unpublishing an effect must not require a
   deploy, and when /content lands, only this file changes: the collections keep
   their shape, `published()` keeps its contract, and every screen keeps reading
   the same way.

   Ids are unique across collections — p1, c-start, f1, s-... — so one flat map
   is enough and the store does not need to know which collection a record came
   from. If that ever stops being true the key becomes `${collection}:${id}`,
   and the migration is a one-liner because nothing outside this file reads it.

   `useSyncExternalStore`, matching lib/kieRates: a module-level store that
   screens subscribe to, so publishing something in the panel repaints the
   surfaces showing it without a reload.
   --------------------------------------------------------------------------- */

const KEY = "vgen:content-overrides";

/** A partial record. Only the fields an admin actually changed. */
export type Patch = Partial<ContentRecord> & Record<string, unknown>;

let patches: Record<string, Patch> = load();
let version = 0;
const subs = new Set<() => void>();

function load(): Record<string, Patch> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    // Anything but a plain object means the key was written by something else,
    // or by an older shape. Start clean rather than merging garbage into content.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function commit() {
  version++;
  try {
    localStorage.setItem(KEY, JSON.stringify(patches));
  } catch {
    // Quota or private mode. The edit still applies for this session — losing it
    // on reload is better than dropping it in front of the admin who made it.
  }
  subs.forEach((f) => f());
}

function subscribe(f: () => void) {
  subs.add(f);
  return () => subs.delete(f);
}

const snapshot = () => version;

/** Seeded rows with the admin's edits applied. Not filtered — see `useContent`. */
export function withPatches<T extends ContentRecord>(rows: T[]): T[] {
  if (Object.keys(patches).length === 0) return rows;
  return rows.map((r) => (patches[r.id] ? ({ ...r, ...patches[r.id] } as T) : r));
}

/**
 * What a user-facing screen should call. Patched, then `published()` — live rows
 * only, in the order an admin chose.
 */
export function useContent<T extends ContentRecord>(rows: T[]): T[] {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return published(withPatches(rows));
}

/**
 * What the panel calls: everything, drafts and archived included, in admin
 * order. A panel that could not see a draft could not publish one.
 */
export function useAllContent<T extends ContentRecord>(rows: T[]): T[] {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return [...withPatches(rows)].sort((a, b) => a.order - b.order);
}

/** Apply an edit. `updatedBy` is the admin account — see docs/admin.md §4. */
export function patchRecord(id: string, changes: Patch, by: string) {
  patches[id] = { ...patches[id], ...changes, updatedAt: Date.now(), updatedBy: by };
  commit();
}

/**
 * Swap a record with its neighbour in admin order.
 *
 * Both ends get written, because order is a property of the pair: moving one
 * row and leaving the other is how two records end up claiming the same slot
 * and the list starts depending on sort stability.
 */
export function moveRecord<T extends ContentRecord>(rows: T[], id: string, dir: -1 | 1, by: string) {
  const list = [...withPatches(rows)].sort((a, b) => a.order - b.order);
  const i = list.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i]!;
  const b = list[j]!;
  patches[a.id] = { ...patches[a.id], order: b.order, updatedAt: Date.now(), updatedBy: by };
  patches[b.id] = { ...patches[b.id], order: a.order, updatedAt: Date.now(), updatedBy: by };
  commit();
}

/**
 * Drop every edit on one record, returning it to what shipped.
 *
 * `order` is deliberately NOT dropped when some other record is patched to hold
 * this one's shipped slot. Reverting used to delete the whole patch, so a record
 * that had been swapped past a neighbour went back to its original order while
 * the neighbour kept the value it was handed — both then claimed one slot, and
 * `published()` sorts by order alone, so their relative position fell to sort
 * stability rather than anyone's intent.
 *
 * Reverting the pair together would be wrong too: the admin asked to undo one
 * row, not to move a second one they did not touch. So status and content go
 * back and the position stays, which is the only reading that leaves the shelf
 * looking like the panel.
 */
export function resetRecord<T extends ContentRecord>(rows: T[], id: string) {
  const patch = patches[id];
  if (!patch) return;
  const shipped = rows.find((r) => r.id === id);
  const collides = shipped != null && Object.entries(patches).some(([otherId, other]) => otherId !== id && other.order === shipped.order);

  if (collides && patch.order != null) patches[id] = { order: patch.order };
  else delete patches[id];
  commit();
}

/** How many records the admin has touched — for the "unsaved vs shipped" note. */
export function useOverrideCount(): number {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return Object.keys(patches).length;
}

/** Drop every edit in the store. Owner-only in the panel. */
export function resetAll() {
  patches = {};
  commit();
}
