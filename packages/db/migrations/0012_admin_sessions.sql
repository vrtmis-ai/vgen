-- =====================================================================
--  62. ADMIN SESSIONS
--
--  Staff sessions are their own table rather than a flag on `sessions`, for
--  three reasons that all follow from the same idea — an admin session is a
--  different thing from a customer session, not a customer session with extra
--  rights:
--
--    * It carries proof that MFA was passed FOR THIS SESSION. A flag on the
--      user, or a recent `mfa_credentials.last_used_at`, says the person owns a
--      second factor at some point, which is not the same claim.
--    * It expires far sooner. A month is right for a customer on their own
--      phone and wrong for an account that can revoke invite codes.
--    * It can be revoked without signing anyone out of the product, and vice
--      versa.
--
--  It also means the cookies are separate, so a stolen customer session is
--  never accidentally an admin one.
-- =====================================================================

CREATE TABLE admin_sessions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,        -- the hash, never the token
  -- Null between password and second factor: the row exists but authorises
  -- nothing, which is what lets the MFA step be a separate request.
  mfa_verified_at timestamptz,
  ip              inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz
);
CREATE INDEX admin_sessions_user_idx ON admin_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX admin_sessions_expiry_idx ON admin_sessions (expires_at) WHERE revoked_at IS NULL;

-- No new roles and no changes to the seeded ones. The admin routes check for
-- `invites.read`, `invites.write`, `promos.read`, `promos.write` and
-- `flags.write`, all of which the seeded `admin` role already holds through its
-- ["*"] wildcard.
--
-- Naming them rather than checking for "is an admin" is the point: granting a
-- campaign manager exactly the invite permissions later is then one UPDATE on
-- `roles`, with no code change and no new boolean that some route forgets to
-- consult.
