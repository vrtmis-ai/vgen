/**
 * A document that is the same for every visitor, rebuilt only when it changes.
 *
 * Three of the four public reads are the same shape: a whole document assembled
 * from a table on every single request, identical for everyone, changing only
 * when somebody publishes. Under load those were the three slowest things the
 * API serves — the catalogue managed 605 requests a second where `/session`
 * managed 12,146 — and the catalogue in particular is the first request a cold
 * visitor makes, so the cost lands before anything is on screen.
 *
 * The cache is per process, not in Redis. Several API processes each keep their
 * own copy and that is fine: what makes them agree is the fingerprint, not a
 * shared store. It also means there is no cache to invalidate by hand, no key
 * to get wrong, and nothing left stale by a deploy that forgot to flush.
 *
 * Each caller writes its own fingerprint query rather than passing table and
 * predicate strings into a builder here. They are three lines each, they are
 * readable next to the query they guard, and the alternative was splicing
 * identifiers through `sql.unsafe` — which is both an injection shape and a
 * thing nobody can debug at speed.
 *
 * **Every one of those queries must count as well as take a maximum**, and that
 * is the whole subtlety. These tables have `updated_at` triggers, so editing a
 * row moves the maximum — but a row *leaving* the set does not necessarily move
 * it, and rows leave constantly: a model is retired, a content item is
 * unpublished, a plan is withdrawn, a whole provider is switched off. Any of
 * those changes what the document says while possibly leaving the newest
 * timestamp exactly where it was. There is a test for that case.
 */
export class PublicDocument<T> {
  private cached: { fingerprint: string; value: T } | null = null;

  constructor(
    private readonly fingerprintOf: () => Promise<string>,
    private readonly build: () => Promise<T>,
  ) {}

  async get(): Promise<T> {
    const fingerprint = await this.fingerprintOf();
    if (this.cached?.fingerprint === fingerprint) return this.cached.value;
    const value = await this.build();
    this.cached = { fingerprint, value };
    return value;
  }
}

/** `count:newest`, the shape every fingerprint query here returns. */
export const fingerprintOf = (count: string | number, ...stamps: (Date | null | undefined)[]): string =>
  [count, ...stamps.map((stamp) => stamp?.getTime() ?? 0)].join(":");
