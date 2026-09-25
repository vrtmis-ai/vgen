-- =====================================================================
--  80. FINDING THE CODE'S OWNER QUICKLY
--
--  A waitlist invite is issued to one person at one address, and the signup
--  form now has to answer "whose code is this?" before it will draw itself —
--  so `/auth/invite/check` looks the binding up by code on a public,
--  unauthenticated route.
--
--  `waitlist_entries.invite_code_id` had no index, so that lookup was a
--  sequential scan of the whole queue on every visit to a signup link. The
--  queue is small today and would not have been noticed; it is the kind of
--  thing that is only ever fixed before it matters.
--
--  Partial, because a row with no code is not an answer to that question and
--  the overwhelming majority of the table is exactly that.
-- =====================================================================

CREATE INDEX waitlist_entries_invite_code_idx
  ON waitlist_entries (invite_code_id)
  WHERE invite_code_id IS NOT NULL;
