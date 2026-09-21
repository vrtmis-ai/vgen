import { foldForMatching, type PromptRule } from "@vgen/core";
import type { Sql } from "postgres";

/**
 * The blocklist, and the record of what it turned away.
 *
 * The platform takes arbitrary text from the public and returns pictures and
 * video made from it. That makes it a content platform whether or not it wants
 * to be one, and the question a regulator asks is not "did you have a policy"
 * but "show me it running". Two tables answer that: the rules that were in
 * force, and the refusals they produced.
 *
 * Reads are cached because this sits in front of every quote and every
 * submission, and the list changes about as often as the law does. See
 * `reload()` for what invalidates it.
 */

export interface PromptRuleRow extends PromptRule {
  note: string | null;
  isActive: boolean;
  createdAt: number;
}

export interface RecordedRejection {
  ruleId: string;
  matchedPhrase: string;
  category: string;
  prompt: string;
  surface: "quote" | "job";
  userId: string;
  accountId?: string | undefined;
}

interface RuleRow {
  id: string;
  phrase: string;
  needle: string;
  category: string;
  reason: string | null;
  note: string | null;
  is_active: boolean;
  created_at: Date;
}

const toRule = (row: RuleRow): PromptRuleRow => ({
  id: row.id,
  phrase: row.phrase,
  needle: row.needle,
  category: row.category,
  reason: row.reason,
  note: row.note,
  isActive: row.is_active,
  createdAt: row.created_at.getTime(),
});

export class PostgresPromptPolicyRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * The active rules, at most one query per `ttlMs`.
   *
   * A cache here is not a micro-optimisation: without it the busiest path on
   * the platform gains a round trip, and the thing it would be fetching is a
   * list that changes when a lawyer says so. The staleness window is the delay
   * between an admin adding a phrase and it taking effect, which is why the
   * write methods below clear it rather than waiting the window out.
   */
  private cache: { rules: PromptRuleRow[]; at: number } | null = null;
  private readonly ttlMs = 60_000;

  async active(now = Date.now()): Promise<PromptRuleRow[]> {
    if (this.cache && now - this.cache.at < this.ttlMs) return this.cache.rules;
    const rows = await this.sql<RuleRow[]>`
      select id, phrase, needle, category, reason, note, is_active, created_at
      from prompt_rules
      where is_active
      order by char_length(needle) desc, created_at
    `;
    // Longest needle first, so the phrase that matched is the most specific one
    // the prompt contains rather than whichever happened to be inserted first.
    // The person is told one reason and it should be the closest one.
    const rules = rows.map(toRule);
    this.cache = { rules, at: now };
    return rules;
  }

  /** Every rule, active or not, for the admin list. Never cached. */
  async list(): Promise<PromptRuleRow[]> {
    const rows = await this.sql<RuleRow[]>`
      select id, phrase, needle, category, reason, note, is_active, created_at
      from prompt_rules
      order by is_active desc, created_at desc
    `;
    return rows.map(toRule);
  }

  /**
   * Add a phrase, folded on the way in.
   *
   * Folding here rather than in the caller is what keeps the two sides of the
   * comparison honest: the needle in the table and the prompt at request time
   * go through one function, so they cannot drift.
   *
   * A phrase that folds to something already present is not an error worth a
   * stack trace — the admin typed the same word on a different keyboard, which
   * is exactly what the folding is for. It answers with the existing row.
   */
  async add(input: {
    phrase: string;
    category: string;
    reason?: string | undefined;
    note?: string | undefined;
    createdBy: string;
  }): Promise<{ outcome: "added" | "exists" | "too_short"; rule: PromptRuleRow | null }> {
    const needle = foldForMatching(input.phrase);
    // The same floor the CHECK constraint holds, answered as a refusal rather
    // than as a constraint violation: a one-character needle matches most
    // Persian sentences, and finding that out in production is expensive.
    if (needle.length < 2) return { outcome: "too_short", rule: null };

    const [row] = await this.sql<RuleRow[]>`
      insert into prompt_rules (phrase, needle, category, reason, note, created_by)
      values (${input.phrase.trim()}, ${needle}, ${input.category}, ${input.reason ?? null}, ${input.note ?? null}, ${input.createdBy})
      on conflict (needle) do nothing
      returning id, phrase, needle, category, reason, note, is_active, created_at
    `;
    this.cache = null;
    if (row) return { outcome: "added", rule: toRule(row) };

    const [existing] = await this.sql<RuleRow[]>`
      select id, phrase, needle, category, reason, note, is_active, created_at
      from prompt_rules where needle = ${needle}
    `;
    return { outcome: "exists", rule: existing ? toRule(existing) : null };
  }

  /**
   * Turn a rule on or off.
   *
   * Never a delete. A rule that refused somebody last week is the justification
   * for that refusal, and deleting it leaves the rejection log pointing at
   * nothing. `is_active` is what stops it matching; the row stays.
   */
  async setActive(id: string, isActive: boolean): Promise<PromptRuleRow | null> {
    const [row] = await this.sql<RuleRow[]>`
      update prompt_rules set is_active = ${isActive} where id = ${id}
      returning id, phrase, needle, category, reason, note, is_active, created_at
    `;
    this.cache = null;
    return row ? toRule(row) : null;
  }

  /**
   * Write down that a prompt was turned away.
   *
   * The account is resolved from the user here rather than passed in, so a
   * caller cannot log a refusal against the wrong account by mistake. A user
   * with no personal account still gets a row — the refusal happened, and
   * losing it because a join came back empty is the one outcome this table
   * exists to prevent.
   */
  async recordRejection(input: RecordedRejection): Promise<void> {
    await this.sql`
      insert into prompt_rejections (account_id, user_id, rule_id, matched_phrase, category, prompt, surface)
      values (
        ${input.accountId ?? this.sql`(select personal_account_id from users where id = ${input.userId})`},
        ${input.userId}, ${input.ruleId}, ${input.matchedPhrase}, ${input.category}, ${input.prompt}, ${input.surface}
      )
    `;
  }

  /** The refusal log, newest first, for the admin console. */
  async rejections(limit = 50): Promise<
    {
      id: string;
      userId: string | null;
      matchedPhrase: string;
      category: string;
      prompt: string;
      surface: string;
      createdAt: number;
    }[]
  > {
    const rows = await this.sql<
      {
        id: string;
        user_id: string | null;
        matched_phrase: string;
        category: string;
        prompt: string;
        surface: string;
        created_at: Date;
      }[]
    >`
      select id, user_id, matched_phrase, category, prompt, surface, created_at
      from prompt_rejections
      order by created_at desc
      limit ${Math.max(1, Math.min(200, Math.trunc(limit)))}
    `;
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      matchedPhrase: row.matched_phrase,
      category: row.category,
      prompt: row.prompt,
      surface: row.surface,
      createdAt: row.created_at.getTime(),
    }));
  }
}
