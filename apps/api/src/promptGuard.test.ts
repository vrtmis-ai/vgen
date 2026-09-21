import { describe, expect, it, vi } from "vitest";
import type { PromptRuleRow } from "@vgen/db";
import { createPromptGuard, permissivePromptGuard } from "./promptGuard";

/* ---------------------------------------------------------------------------
   The guard, and the two things about it that are not obvious.

   First: a refusal has to be written down. The platform is answerable for what
   it publishes, and "we filter prompts" is a claim until there is a log that
   shows the filter running. Second: the write failing must not rescue the
   request — a logging outage turning into a content incident is exactly the
   trade this is here to refuse.

   The matching itself is tested in @vgen/core, against real Persian spellings.
   What is tested here is the plumbing around it.
   --------------------------------------------------------------------------- */

const RULE: PromptRuleRow = {
  id: "rule-1",
  phrase: "کیک",
  needle: "کیک",
  category: "test_category",
  reason: "دلیل فارسی",
  note: null,
  isActive: true,
  createdAt: 0,
};

function policy(rules: (typeof RULE)[], recordRejection = vi.fn(async () => undefined)) {
  return { active: vi.fn(async () => rules), recordRejection } as never;
}

describe("the prompt guard", () => {
  it("lets a prompt through when no rule is broken", async () => {
    const record = vi.fn(async () => undefined);
    const guard = createPromptGuard(policy([RULE], record));

    expect(await guard.check({ prompt: "a lighthouse at dawn", userId: "u1", surface: "quote" })).toBeNull();
    // Nothing happened, so nothing is written. A log of every prompt is a
    // different product with a different privacy answer.
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses a prompt that breaks a rule, however it was spelled", async () => {
    // Arabic kaf and yeh, plus a half-space — the same word on another keyboard.
    const guard = createPromptGuard(policy([RULE]));

    const refusal = await guard.check({ prompt: "یک كي‌ك بساز", userId: "u1", surface: "job" });

    expect(refusal).not.toBeNull();
    expect(refusal?.category).toBe("test_category");
  });

  it("tells the person the rule's own reason, never the phrase", async () => {
    const guard = createPromptGuard(policy([RULE]));

    const refusal = await guard.check({ prompt: "کیک", userId: "u1", surface: "job" });

    // A refusal that quotes the phrase teaches the blocklist one request at a
    // time, and the list only works while it is unpublished.
    expect(refusal?.message).toBe("دلیل فارسی");
    expect(refusal?.message).not.toContain(RULE.phrase);
  });

  it("falls back to a general message when a rule carries no reason", async () => {
    const guard = createPromptGuard(policy([{ ...RULE, reason: null }]));

    const refusal = await guard.check({ prompt: "کیک", userId: "u1", surface: "job" });

    expect(refusal?.message).toContain("قوانین محتوایی");
  });

  it("records the refusal with the surface it happened on", async () => {
    const record = vi.fn(async () => undefined);
    const guard = createPromptGuard(policy([RULE], record));

    await guard.check({ prompt: "کیک", userId: "u1", surface: "quote" });

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: "rule-1", category: "test_category", surface: "quote", userId: "u1", prompt: "کیک" }),
    );
  });

  /* The one that would otherwise be found in production. If the insert throws
     and the guard rethrows, the route 500s and — depending on how the client
     retries — the generation may simply be tried again. The refusal must stand
     on its own. */
  it("still refuses when the refusal cannot be written down", async () => {
    const record = vi.fn(async () => {
      throw new Error("database is down");
    });
    const log = vi.fn();
    const guard = createPromptGuard(policy([RULE], record as never), log);

    const refusal = await guard.check({ prompt: "کیک", userId: "u1", surface: "job" });

    expect(refusal).not.toBeNull();
    expect(log).toHaveBeenCalledOnce();
  });

  it("refuses nothing at all when no rules have been written", async () => {
    // The day-one state of a deployment whose owner has not written the list.
    const guard = createPromptGuard(policy([]));
    expect(await guard.check({ prompt: "anything", userId: "u1", surface: "job" })).toBeNull();
    expect(await permissivePromptGuard.check({ prompt: "anything", userId: "u1", surface: "job" })).toBeNull();
  });
});
