import { firstBrokenRule } from "@vgen/core";
import type { PostgresPromptPolicyRepository } from "@vgen/db";

/**
 * The one place a prompt is read before it becomes a picture.
 *
 * The platform accepts arbitrary text from the public and returns images and
 * video made from it. Nothing inspected that text: the only guard on the
 * submission path was an account-level ban, which answers "is this person
 * allowed to generate" and never "is this a thing we will make".
 *
 * Checked on both surfaces that carry a prompt, which is a deliberate pair
 * rather than belt and braces:
 *
 *   · The **quote** is where a person finds out, before they have committed
 *     to anything and before a hold is placed on their credits. Refusing only
 *     at submission would price a generation and then decline it, which reads
 *     as the product being broken.
 *   · The **job** is the one that matters, because it is what dispatches. A
 *     client can skip the quote path or replay an old quote id; this is the
 *     gate that is actually load-bearing.
 *
 * One guard in front of both, not one per provider. Every generation funnels
 * through these two routes, so a model added next year is covered by having
 * been added at all.
 */

export interface PromptGuardApplication {
  /** Null when the prompt may proceed. */
  check(input: { prompt: string; userId: string; surface: "quote" | "job" }): Promise<PromptRefusal | null>;
}

export interface PromptRefusal {
  /** Persian, and specific enough to act on without naming the phrase. */
  message: string;
  category: string;
}

/**
 * What a refused person is told.
 *
 * Never the phrase that matched. A refusal that quotes the rule teaches the
 * blocklist one request at a time, and the list is the one thing about this
 * system that has to stay unpublished to keep working. The category is safe:
 * it names the published rule, not our spelling of it.
 */
const DEFAULT_MESSAGE = "این درخواست با قوانین محتوایی سایت سازگار نیست و انجام نشد.";

export function createPromptGuard(policy: PostgresPromptPolicyRepository, log?: (error: unknown) => void): PromptGuardApplication {
  return {
    async check({ prompt, userId, surface }) {
      const rules = await policy.active();
      const match = firstBrokenRule(prompt, rules);
      if (!match) return null;

      /* The refusal is recorded, and a failure to record it does not rescue
         the request. Those are two separate decisions and both are deliberate:
         a refusal we cannot produce later is a policy we cannot demonstrate,
         but letting the generation through because the audit insert failed
         would turn a logging outage into a content incident. */
      try {
        await policy.recordRejection({
          ruleId: match.rule.id,
          matchedPhrase: match.rule.phrase,
          category: match.rule.category,
          prompt,
          surface,
          userId,
        });
      } catch (error) {
        log?.(error);
      }

      return { message: match.rule.reason ?? DEFAULT_MESSAGE, category: match.rule.category };
    },
  };
}

/**
 * A guard with no rule set, for a deployment that has not written one.
 *
 * It refuses nothing, which is the honest behaviour: the mechanism ships
 * before the list, and a list invented by the program would read as policy
 * while being nobody's policy.
 */
export const permissivePromptGuard: PromptGuardApplication = {
  async check() {
    return null;
  },
};
