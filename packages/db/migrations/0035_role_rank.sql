-- =====================================================================
--  77. A ROLE CAN NOW OUTRANK ANOTHER, AND ONE OF THEM IS THE OWNER
--
--  `admin` holds ["*"], and the only rule standing between two admins was
--  "you cannot change somebody who holds access you do not" -- which, between
--  two accounts that both hold everything, refuses nothing. Any admin could
--  revoke any other, including the person the site belongs to. That is fine
--  for a team of peers and wrong for a business with one owner.
--
--  Rank is deliberately not a permission. A permission answers "may you do
--  this thing"; rank answers "may you do it to *this person*". They are
--  different questions, and `*` can only express the first -- which is exactly
--  why the gap existed.
--
--  Two rules the routes enforce on top of this column, and one that falls out
--  of them for free:
--
--    * you cannot act on somebody ranked above you, so an admin cannot touch
--      an owner;
--    * you cannot appoint anyone to a role ranked above your own, so only an
--      owner makes an owner;
--    * therefore a lone owner cannot be removed by anybody -- no admin
--      outranks them, no other owner exists, and nobody may edit themselves.
--      No "last owner" counter is needed; it would be a third rule saying what
--      the first two already say.
--
--  Gaps between the numbers so a role can be slotted between two that exist
--  without renumbering either side.
-- =====================================================================

ALTER TABLE roles ADD COLUMN rank smallint NOT NULL DEFAULT 0;

UPDATE roles SET rank = 50 WHERE code = 'admin';
UPDATE roles SET rank = 20 WHERE code = 'moderator';
UPDATE roles SET rank = 10 WHERE code = 'support';

-- Same permissions as `admin`. The difference between them is not what they
-- may do, it is who may undo them.
INSERT INTO roles (code, name, permissions, rank) VALUES
  ('owner', 'Owner', '["*"]', 100)
ON CONFLICT (code) DO NOTHING;

-- No row is promoted here. Which address owns the site is an operational fact
-- about one deployment, not a property of the schema, and this repository is
-- public -- so it is `pnpm staff:promote <email> owner`, run once on the
-- server, rather than an email address committed to git.
