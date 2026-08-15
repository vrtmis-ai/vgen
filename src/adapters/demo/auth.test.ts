import { describe, expect, it } from "vitest";
import { DEMO_OTP_CODE, createDemoAuthService, createDemoAuthState } from "./auth";
import { ApiError } from "../../runtime/apiError";
import { createDemoSessionService } from "./session";

const NOW = () => 1_700_000_000_000;

function harness(startAnonymous = true) {
  const state = createDemoAuthState(!startAnonymous);
  return { auth: createDemoAuthService(state, NOW), session: createDemoSessionService(state) };
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
  throw new Error("Expected the call to reject");
}

describe("demo auth", () => {
  it("starts signed out so a sign-in screen has something to do", async () => {
    const { session } = harness();
    expect((await session.getCurrent()).status).toBe("anonymous");
  });

  it("keeps the whole product reachable by default", async () => {
    // The default is authed on purpose: demo mode's job is that every screen
    // works with no backend, and an unbuilt sign-in screen must not stand in
    // front of them.
    const { session } = harness(false);
    expect((await session.getCurrent()).status).toBe("authed");
  });

  it("signs in through the session the session service reports", async () => {
    const { auth, session } = harness();
    await auth.register({ email: "new@deev.local", password: "correct-horse-battery", inviteCode: "APPLE-DEEV" });

    const current = await session.getCurrent();
    expect(current.status).toBe("authed");
    expect(current.status === "authed" && current.user.emailNormalized).toBe("new@deev.local");
  });

  it("signs back out", async () => {
    const { auth, session } = harness(false);
    await auth.logout();
    expect((await session.getCurrent()).status).toBe("anonymous");
  });

  it("enforces the invite gate, because production does", async () => {
    const { auth } = harness();
    expect(await codeOf(() => auth.register({ email: "a@b.co", password: "correct-horse-battery" }))).toBe("invite_required");
    expect(await codeOf(() => auth.register({ email: "a@b.co", password: "correct-horse-battery", inviteCode: "INVALID" }))).toBe(
      "invite_invalid",
    );
  });

  it("models the failures a sign-in screen has to tell apart", async () => {
    const { auth } = harness();
    expect(await codeOf(() => auth.verifyPhone({ phone: "09123334444", code: "000000", inviteCode: "OK" }))).toBe("otp_invalid");
    expect(await codeOf(() => auth.register({ email: "taken@deev.local", password: "correct-horse-battery", inviteCode: "OK" }))).toBe(
      "account_taken",
    );
    expect(await codeOf(() => auth.login({ email: "a@b.co", password: "short" }))).toBe("invalid_credentials");
    expect(await codeOf(() => auth.startPhoneVerification({ phone: "nope" }))).toBe("invalid_phone");
  });

  it("accepts the phone shapes Iranians actually type", async () => {
    const { auth } = harness();
    for (const phone of ["09123334444", "+989123334444", "۰۹۱۲۳۳۳۴۴۴۴"]) {
      await expect(auth.startPhoneVerification({ phone })).resolves.toMatchObject({ sent: true });
    }
  });

  it("completes the phone route with the documented code", async () => {
    const { auth, session } = harness();
    const started = await auth.startPhoneVerification({ phone: "09123334444" });
    expect(started.expiresAt).toBeGreaterThan(NOW());

    await auth.verifyPhone({ phone: "09123334444", code: DEMO_OTP_CODE, inviteCode: "APPLE-DEEV" });
    expect((await session.getCurrent()).status).toBe("authed");
  });
});
