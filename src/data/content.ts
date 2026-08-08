// The shape every admin-editable record shares.
//
// The admin panel is the last thing we build, but it is not the last thing we
// design for. A panel is only ever a UI over records; if the records have no
// publish state and no ordering, the panel cannot exist without a migration
// and a rewrite of every screen that reads them. So the fields go in now, while
// the collections are still small enough that adding them is free.
//
// Screens must read through `published()` rather than mapping the raw array.
// That one habit is what lets an admin stage an effect, reorder a shelf, or
// pull something without a deploy.

export type ContentStatus = "draft" | "published" | "archived";

export interface ContentRecord {
  id: string;
  status: ContentStatus;
  /** Manual sort inside its own collection; lower comes first. */
  order: number;
  /** Set server-side on write. Milliseconds, absolute — never a relative date. */
  updatedAt: number;
  /** The admin account that last wrote it. Absent on seeded rows. */
  updatedBy?: string;
}

/** What a surface is allowed to show: live rows, in the order an admin chose. */
export function published<T extends ContentRecord>(rows: T[]): T[] {
  return rows.filter((r) => r.status === "published").sort((a, b) => a.order - b.order);
}

/**
 * Admin roles.
 *
 * Kept here rather than in the panel because the surfaces have to know them
 * too: a content admin previewing a draft effect needs the same screen the user
 * gets, and the "draft" badge has to come from somewhere.
 *
 * Deliberately not one `isAdmin` flag. The person who uploads effects is not
 * the person who issues credits, and the day those are the same permission is
 * the day a content mistake can move money.
 */
export type AdminRole =
  /** Effects, courses, featured shelves, community moderation. No money. */
  | "content"
  /** Plans, prices, credit grants, refunds, revenue. No content. */
  | "commerce"
  /** Reads users and jobs, can re-run a failed job or refund one. Nothing else. */
  | "support"
  /** Everything, including granting roles. Should be one or two people. */
  | "owner";
