-- ---------------------------------------------------------------------
--  Somebody says a published post should not be there
--
--  0029 gave staff a way to take a post down. This is the other half: a
--  way for the report to arrive in the first place. Until now the only
--  route in was a message to whatever address the site listed, which is
--  not a mechanism so much as a hope.
--
--  Deliberately NOT wired to un-publish anything on its own. A report
--  that hides a post is a heckler's veto with a single click, and the
--  first thing anybody does with one is aim it at a competitor. What a
--  report does is put the post in front of a person, who already has a
--  takedown route to act with.
--
--  The queue it feeds is a read over this table rather than a second
--  status on `posts`: flipping an approved post back to 'pending' would
--  un-publish it, which is the veto again by another name.
-- ---------------------------------------------------------------------
CREATE TABLE post_reports (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  post_id      uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  -- Nullable so a report survives the reporter deleting their account.
  -- Who complained matters much less than what was complained about, and
  -- losing the report with the person would be the wrong trade.
  reporter_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Which published category of the mandated content list the reporter
  -- says this falls under. Free text alongside it, because the person
  -- reporting is not a lawyer and the category list is not exhaustive.
  category     text NOT NULL DEFAULT 'other',
  note         text CONSTRAINT post_reports_note_length_check CHECK (note IS NULL OR char_length(note) <= 500),
  -- Set when staff have looked, whatever they decided. A report that was
  -- read and dismissed is resolved; the outcome lives in audit_log and
  -- in whether the post is still visible.
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- One per person per post. Without this the count is a measure of how
  -- determined one person is rather than of how many people objected,
  -- and the queue sorts by exactly that number.
  CONSTRAINT post_reports_once_per_person UNIQUE (post_id, reporter_id)
);

-- The queue: unresolved first, and the busiest post first within that.
CREATE INDEX post_reports_open_idx ON post_reports (created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX post_reports_post_idx ON post_reports (post_id);
