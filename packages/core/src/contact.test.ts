import { describe, expect, it } from "vitest";
import { readContact } from "./contact";

/* One field, either kind. A second control asking "email or phone?" is a
   question the value already answers. */

describe("what a waitlist field was given", () => {
  it("takes an Iranian mobile in the shapes people type it", () => {
    for (const typed of ["09121234567", "9121234567", "+989121234567", "00989121234567", "0912 123 4567", "0912-123-4567"]) {
      expect(readContact(typed)).toEqual({ kind: "phone", value: "09121234567" });
    }
  });

  it("takes an address, and normalises nothing about it", () => {
    expect(readContact("  someone@example.com ")).toEqual({ kind: "email", value: "someone@example.com" });
  });

  it("refuses what is neither", () => {
    for (const typed of ["", "   ", "hello", "09121", "0912123456789", "someone@example", "@example.com"]) {
      expect(readContact(typed)).toBeNull();
    }
  });

  /* The reason this moved out of the browser. `POST /auth/waitlist` folds the
     number with this same function before the unique index sees it, so four
     spellings of one mobile are one place in the queue rather than four. If
     the two sides ever disagreed, a value the form accepted would be a value
     the route refused. */
  it("folds every spelling of one number to the same stored value", () => {
    const stored = new Set(
      ["09121234567", "9121234567", "+989121234567", "00989121234567", "0912 123 4567"].map((typed) => readContact(typed)?.value),
    );
    expect([...stored]).toEqual(["09121234567"]);
  });
});
