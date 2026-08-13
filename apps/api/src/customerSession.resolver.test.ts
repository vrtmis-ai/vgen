import { beforeEach, describe, expect, it, vi } from "vitest";

const clerkMocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  singletonGetUser: vi.fn(),
}));

vi.mock("@clerk/fastify", () => ({
  getAuth: clerkMocks.getAuth,
  clerkClient: { users: { getUser: clerkMocks.singletonGetUser } },
}));

import { FastifyClerkPrincipalResolver } from "./customerSession";

describe("FastifyClerkPrincipalResolver", () => {
  beforeEach(() => {
    clerkMocks.getAuth.mockReset();
    clerkMocks.singletonGetUser.mockReset();
  });

  it("loads the user through the request-scoped Clerk client", async () => {
    clerkMocks.getAuth.mockReturnValue({ isAuthenticated: true, userId: "user_google_1" });
    clerkMocks.singletonGetUser.mockRejectedValue(new Error("unconfigured singleton"));
    const requestGetUser = vi.fn(async () => ({
      id: "user_google_1",
      primaryEmailAddressId: "email_1",
      emailAddresses: [{ id: "email_1", emailAddress: "Person@Example.com" }],
      firstName: "Deev",
      lastName: "User",
      imageUrl: "https://example.com/avatar.png",
    }));
    const request = { clerk: { users: { getUser: requestGetUser } } };

    await expect(new FastifyClerkPrincipalResolver().resolve(request as never)).resolves.toEqual({
      clerkUserId: "user_google_1",
      emailNormalized: "person@example.com",
      displayName: "Deev User",
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(requestGetUser).toHaveBeenCalledWith("user_google_1");
    expect(clerkMocks.singletonGetUser).not.toHaveBeenCalled();
  });
});
