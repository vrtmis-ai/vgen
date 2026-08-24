import { describe, expect, it } from "vitest";
import { FAMILIES } from "../../data/models";
import { CatalogSnapshotSchema, ControlSchema } from "./catalog";
import { CreateGenerationRequestSchema, GenerationJobSchema } from "./generation";
import { SessionSchema } from "./session";
import { WalletSchema } from "./wallet";

describe("application contracts", () => {
  it("accepts the complete current model catalog", () => {
    expect(() => CatalogSnapshotSchema.parse({ version: "catalog-test", publishedAt: Date.now(), families: FAMILIES })).not.toThrow();
  });

  it("rejects catalog sliders whose default is outside the provider range", () => {
    expect(() => ControlSchema.parse({ kind: "slider", key: "duration", label: "Duration", min: 4, max: 10, step: 1, def: 12 })).toThrow(
      "Slider default must be inside its range",
    );
  });

  it("requires an authenticated session to contain a real account", () => {
    expect(() => SessionSchema.parse({ status: "authed", host: "web" })).toThrow();
  });

  it("accepts a fractional balance and still rejects a negative one", () => {
    // Generations bill in hundredths of a coin, so what is left after spending
    // is a fraction. Rejecting it here would fail a wallet the ledger holds
    // perfectly well; below zero is still the impossible case.
    expect(() => WalletSchema.parse({ spendable: 1.5, grants: [] })).not.toThrow();
    expect(() => WalletSchema.parse({ spendable: -1, grants: [] })).toThrow();
  });

  it("requires durable idempotency keys and supports terminal job failures", () => {
    expect(() => CreateGenerationRequestSchema.parse({ quoteId: "quote-1", idempotencyKey: "short", input: {} })).toThrow();

    const failed = GenerationJobSchema.parse({
      id: "job-1",
      familyId: "flux",
      variantId: "flux-fast",
      status: "failed",
      coins: 0,
      prompt: "a small red boat",
      createdAt: 1,
      updatedAt: 2,
      outputs: [],
      urlsExpireAt: null,
      error: { code: "provider_unavailable", message: "Try again" },
    });
    expect(failed.status).toBe("failed");
    // Zero coins on a failure is not an omission: every job failure is
    // refunded in full, so the charge really is nothing.
    expect(failed.coins).toBe(0);

    // The vocabulary is the database's. `done` was this file's own invention
    // and would have failed to parse every real reply.
    expect(() => GenerationJobSchema.parse({ ...failed, status: "done" })).toThrow();
  });
});
