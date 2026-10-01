import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { withBackupStore, type BackupFailure } from "./backupStore";
import type { ObjectStore } from "./objectStore";

function fakeStore(bucket: string, puts: string[] = []): ObjectStore & { puts: string[] } {
  return {
    puts,
    bucket,
    ensureBucket: async () => {},
    delete: async () => {},
    signedUrl: async (key: string) => `https://${bucket}.test/${key}`,
    put: async (key: string, body: Uint8Array, mimeType: string) => {
      puts.push(key);
      return { bucket, key, byteSize: body.byteLength, sha256: createHash("sha256").update(body).digest("hex"), mimeType };
    },
  };
}

const BYTES = new Uint8Array([1, 2, 3]);

describe("withBackupStore", () => {
  it("writes the object to both stores and answers with the primary's", async () => {
    const primary = fakeStore("vgen");
    const backup = fakeStore("offsite");

    const stored = await withBackupStore(primary, backup, vi.fn()).put("generated/a.png", BYTES, "image/png");

    expect(primary.puts).toEqual(["generated/a.png"]);
    expect(backup.puts).toEqual(["generated/a.png"]);
    // The bucket is recorded on the asset row, so it has to be the one reads go to.
    expect(stored.bucket).toBe("vgen");
  });

  /**
   * The whole point of the wrapper. In the worker this `put` runs inside a retry
   * loop that re-downloads the provider's output, and the customer has already
   * been charged for it — so a far store having a bad minute must not cost the
   * generation.
   */
  it("keeps the write when the backup fails, and reports it", async () => {
    const primary = fakeStore("vgen");
    const backup = { ...fakeStore("offsite"), put: async () => Promise.reject(new Error("connection reset")) };
    const failures: BackupFailure[] = [];

    const stored = await withBackupStore(primary, backup, (failure) => failures.push(failure)).put("generated/a.png", BYTES, "image/png");

    expect(stored.key).toBe("generated/a.png");
    expect(failures).toEqual([{ operation: "put", bucket: "offsite", key: "generated/a.png", error: "connection reset" }]);
  });

  it("does not let an unusable backup bucket stop the process starting", async () => {
    const primary = fakeStore("vgen");
    const backup = { ...fakeStore("offsite"), ensureBucket: async () => Promise.reject(new Error("AccessDenied")) };
    const failures: BackupFailure[] = [];

    await withBackupStore(primary, backup, (failure) => failures.push(failure)).ensureBucket();

    expect(failures.map((failure) => failure.operation)).toEqual(["ensureBucket"]);
  });

  /** Reads are the one thing that must not move: see the note on the wrapper. */
  it("signs reads against the primary only", async () => {
    const backup = fakeStore("offsite");
    const backupSigned = vi.spyOn(backup, "signedUrl");

    const url = await withBackupStore(fakeStore("vgen"), backup, vi.fn()).signedUrl("generated/a.png");

    expect(url).toBe("https://vgen.test/generated/a.png");
    expect(backupSigned).not.toHaveBeenCalled();
  });
});
