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

  it("rejects fractional balances at the API boundary", () => {
    expect(() => WalletSchema.parse({ spendable: 1.5, grants: [] })).toThrow();
  });

  it("requires durable idempotency keys and supports terminal job failures", () => {
    expect(() => CreateGenerationRequestSchema.parse({ quoteId: "quote-1", idempotencyKey: "short" })).toThrow();
    expect(
      GenerationJobSchema.parse({
        id: "job-1",
        familyId: "flux",
        variantId: "flux-fast",
        status: "failed",
        createdAt: 1,
        updatedAt: 2,
        error: { code: "provider_unavailable", message: "Try again" },
      }).status,
    ).toBe("failed");
  });
});
