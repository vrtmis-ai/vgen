-- =====================================================================
--  79. A QUEUE FOR THE PEOPLE WITHOUT AN INVITE CODE
--
--  `early_access` has been on since the gate went up, and the only answer the
--  holding page could give was a code — which is the one thing a stranger does
--  not have. Everyone else read «فقط با کد دعوت» and left, which is the
--  opposite of what a holding page is for while invites are still being handed
--  out by hand.
--
--  The screen for this shipped in #122. Its two routes did not, so the form
--  posted into a 404 and told people to try again. This is the table behind
--  them.
--
--  WHAT IT IS NOT: this is not an account, and nothing here logs anybody in.
--  Signup stays invite-only — `authRepository.createAccount` refuses without a
--  code while the flag is up — and a row here is a claim on a future code,
--  nothing more.
-- =====================================================================

CREATE TABLE waitlist_entries (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- How we would reach them. Only 'email' can be acted on today: SMS sign-in is
  -- switched off and invites go out by mail. A number is still worth taking —
  -- it is demand, and it costs nothing to hold until there is a channel for it.
  channel        text NOT NULL CHECK (channel IN ('email','phone')),

  -- Normalised before it arrives: an address as typed, a mobile folded to the
  -- `09…` form every other phone column in this schema uses. `citext` so that
  -- two capitalisations of one address cannot take two places in the queue.
  contact        citext NOT NULL UNIQUE,

  -- Set when a code is sent. Both stay null until then, and the pair is what
  -- separates "waiting" from "already asked in".
  invited_at     timestamptz,
  invite_code_id uuid REFERENCES invite_codes(id),

  -- Set if they redeem it and become an account, which is the only way to tell
  -- an invite that worked from one that was never opened.
  user_id        uuid REFERENCES users(id),

  --  `clock_timestamp()`, not `now()`, and this is the one column in the schema
  --  where that matters. `now()` is the transaction's start time, identical for
  --  every row written inside one, so two rows created in the same transaction
  --  tie — and the tie falls to a uuid v7's random low bits, which is a coin
  --  flip. Everywhere else `created_at` is a stamp for reading later. Here it
  --  decides who is invited first, so it has to be the moment of the insert.
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);

--  UNIQUE (contact) above is the queue's only fairness rule: one person, one
--  place, and asking twice does not move you — forward or back. The route
--  leans on it with ON CONFLICT DO NOTHING so a second attempt answers exactly
--  as the first did, which is also what stops the page from becoming a way to
--  ask whether an address is already listed.

--  Oldest first is the order the queue is read in, and the only order it is
--  ever read in. `id` rides along because it is a uuid v7 and breaks a tie
--  between two rows that landed in the same instant without a second sort.
CREATE INDEX waitlist_entries_queue_idx ON waitlist_entries (created_at, id);

--  Answering "who is still waiting" without walking the invited ones.
CREATE INDEX waitlist_entries_waiting_idx ON waitlist_entries (created_at) WHERE invited_at IS NULL;
