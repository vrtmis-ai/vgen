import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresPromptPolicyRepository } from "./promptPolicyRepository";
import { connect, inRollback, makeUser } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/* ---------------------------------------------------------------------------
   The blocklist, where it is stored rather than where it is matched.

   The matching is tested in @vgen/core against real Persian spellings. What is
   tested here is the thing that makes that matching work at all: the needle is
   folded on the way *in*, so the stored side and the request side go through
   one function and cannot drift. A rule saved as typed would match nothing but
   the exact keyboard it was typed on.
   --------------------------------------------------------------------------- */

describe("storing a rule", () => {
  it("folds the phrase on the way in", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);

      // Arabic kaf and yeh, and a half-space. What an admin actually types.
      const added = await new PostgresPromptPolicyRepository(tx).add({
        phrase: "كي‌ك",
        category: "test",
        createdBy: userId,
      });

      expect(added.outcome).toBe("added");
      // Stored folded, so the comparison at request time is a plain scan and
      // the two sides cannot be normalised differently.
      expect(added.rule?.needle).toBe("کیک");
      // And the phrase is kept as typed, for the admin list.
      expect(added.rule?.phrase).toBe("كي‌ك");
    });
  });

  it("treats the same word on another keyboard as the same rule", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const policy = new PostgresPromptPolicyRepository(tx);
      await policy.add({ phrase: "کیک", category: "test", createdBy: userId });

      const again = await policy.add({ phrase: "كي‌ك", category: "test", createdBy: userId });

      // Not an error worth a stack trace: the admin typed the same word, which
      // is exactly what the folding is for. The existing row comes back.
      expect(again.outcome).toBe("exists");
      expect(again.rule?.needle).toBe("کیک");
    });
  });

  it("refuses a needle too short to mean anything", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);

      // A one-character needle matches most Persian sentences, and finding
      // that out in production is expensive. Refused as an outcome rather than
      // as a constraint violation.
      const added = await new PostgresPromptPolicyRepository(tx).add({ phrase: "ک", category: "test", createdBy: userId });

      expect(added.outcome).toBe("too_short");
      expect(added.rule).toBeNull();
    });
  });
});

describe("reading the rules", () => {
  it("puts the most specific needle first", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const policy = new PostgresPromptPolicyRepository(tx);
      await policy.add({ phrase: "ab", category: "test", createdBy: userId });
      await policy.add({ phrase: "abcdef", category: "test", createdBy: userId });

      const active = await policy.active(Date.now() + 1);

      // The person is told one reason, and it should be the closest one rather
      // than whichever rule happened to be inserted first.
      expect(active[0]?.needle).toBe("abcdef");
    });
  });

  it("leaves a deactivated rule out", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const policy = new PostgresPromptPolicyRepository(tx);
      const added = await policy.add({ phrase: "کیک", category: "test", createdBy: userId });

      await policy.setActive(added.rule!.id, false);

      // Never a delete: the rule that refused somebody last week is the
      // justification for that refusal, and the rejection log points at it.
      expect((await policy.active(Date.now() + 1)).some((rule) => rule.needle === "کیک")).toBe(false);
      expect((await policy.list()).some((rule) => rule.needle === "کیک")).toBe(true);
    });
  });
});

describe("recording a refusal", () => {
  it("writes the prompt, the rule and the surface", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const policy = new PostgresPromptPolicyRepository(tx);
      const added = await policy.add({ phrase: "کیک", category: "illegal", createdBy: userId });

      await policy.recordRejection({
        ruleId: added.rule!.id,
        matchedPhrase: added.rule!.phrase,
        category: "illegal",
        prompt: "یک کیک بساز",
        surface: "job",
        userId,
      });

      const [row] = await policy.rejections();
      // The prompt in full. A hash proves a refusal happened and nothing about
      // what was refused, which is precisely what an investigator asks.
      expect(row?.prompt).toBe("یک کیک بساز");
      expect(row?.surface).toBe("job");
      expect(row?.category).toBe("illegal");
    });
  });

  it("keeps the record when the rule behind it is deleted", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const policy = new PostgresPromptPolicyRepository(tx);
      const added = await policy.add({ phrase: "کیک", category: "illegal", createdBy: userId });
      await policy.recordRejection({
        ruleId: added.rule!.id,
        matchedPhrase: added.rule!.phrase,
        category: "illegal",
        prompt: "یک کیک بساز",
        surface: "quote",
        userId,
      });

      await tx`delete from prompt_rules where id = ${added.rule!.id}`;

      // No foreign key on purpose: a rule deleted next year must not take the
      // evidence of last year's refusal with it. The phrase was copied.
      const [row] = await policy.rejections();
      expect(row?.matchedPhrase).toBe("کیک");
    });
  });
});
