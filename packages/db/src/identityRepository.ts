import type { CustomerSessionUser } from "@vgen/contracts";
import type { Sql } from "postgres";

export class CustomerIdentityConflictError extends Error {
  readonly code = "customer_identity_conflict";

  constructor() {
    super("Verified email belongs to another DEEV account");
    this.name = "CustomerIdentityConflictError";
  }
}

export class AuthNotImplementedError extends Error {
  readonly code = "auth_not_implemented";

  constructor() {
    super("DEEV auth is not wired yet. Sign-in arrives with the own-auth phase.");
    this.name = "AuthNotImplementedError";
  }
}

export interface CustomerProfile {
  externalUserId: string;
  emailNormalized: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface CustomerRepository {
  upsertFromProfile(profile: CustomerProfile): Promise<CustomerSessionUser>;
}

/**
 * Deliberately unimplemented.
 *
 * The previous version created a user, linked a Clerk identity and granted a
 * 12-coin signup gift, all against tables that no longer exist. Its replacement
 * is not a translation of that code: on the deev-db schema a signup also creates
 * a personal `accounts` row, records a `trial_grants` entry keyed by phone hash
 * so a deleted account cannot re-claim a trial, checks the early-access invite
 * gate, and writes a `device_fingerprints` row. That belongs with the auth work
 * that introduces those flows, not ahead of it.
 *
 * Nothing reaches this today — `AnonymousPrincipalResolver` never resolves a
 * profile, so `CustomerSessionService` returns anonymous before it gets here.
 * Throwing rather than half-implementing means that if a future resolver does
 * land before this does, it fails immediately and says why, instead of writing
 * a user row with no account, no balance and no trial record behind it.
 */
export class PostgresCustomerRepository implements CustomerRepository {
  // Held rather than used: the auth phase fills the method below in against
  // this connection, and threading it through the composition root now means
  // that change touches one file instead of three.
  constructor(readonly sql: Sql) {}

  async upsertFromProfile(_profile: CustomerProfile): Promise<CustomerSessionUser> {
    throw new AuthNotImplementedError();
  }
}
