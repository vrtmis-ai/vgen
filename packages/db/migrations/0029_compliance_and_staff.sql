-- ---------------------------------------------------------------------
--  Three things eNamad review will not pass without, and one the panel
--  has needed since it was built.
--
--  Grouped into one migration because they are one submission: an
--  evaluator logs into a real account, walks the generation flow, and
--  reads the legal pages. A generator that accepts any prompt, a signup
--  that records no agreement, and a takedown that needs a DBA are three
--  faces of the same finding.
--
--  What is deliberately NOT here: the blocklist contents. The mechanism
--  is code, the list is a legal judgement, and a list guessed at by a
--  program is worse than an empty one -- it reads as policy while being
--  nobody's policy. `prompt_rules` ships empty and the guard is a no-op
--  until somebody with standing fills it.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
--  1. What a prompt may not say
--
--  Substrings, never regular expressions. Three reasons, in order of how
--  much they cost to learn the hard way:
--
--    * A pattern typed into an admin field runs against every prompt on
--      the platform. One catastrophic backtracker is a self-inflicted
--      outage, and this repository already carries CodeQL findings for
--      polynomial ReDoS in code where the input is *not* attacker-shaped.
--    * A blocklist is a list of words. Every regex written against one
--      in practice is an escaped literal with .* around it.
--    * A substring match can be explained to a reviewer, and to the
--      person whose generation was refused.
--
--  `needle` is stored already folded -- see foldForMatching() in
--  packages/core. Folding at write time rather than at match time means
--  the comparison is a plain scan and the same normalisation cannot
--  drift between the two sides.
-- ---------------------------------------------------------------------
CREATE TABLE prompt_rules (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- As typed, for the admin list. Never matched against.
  phrase        text NOT NULL,
  -- As matched: case-folded, Persian/Arabic letter pairs unified, ZWNJ
  -- and tatweel stripped, Arabic-Indic digits folded to ASCII. Written
  -- by the application, never by hand.
  needle        text NOT NULL,
  -- Which published category of the mandated content list this stands
  -- for, so a refusal can be defended by pointing at a rule rather than
  -- at a mood.
  category      text NOT NULL DEFAULT 'other',
  -- Shown to the person refused. Persian, because they are.
  reason        text,
  note          text,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_rules_needle_key UNIQUE (needle),
  -- A one-character needle matches most Persian sentences. The floor is
  -- not a style rule: it is what stops a slip from refusing everything.
  CONSTRAINT prompt_rules_needle_length_check CHECK (char_length(needle) >= 2)
);

CREATE INDEX prompt_rules_active_idx ON prompt_rules (needle) WHERE is_active;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON prompt_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------
--  2. That the refusal happened
--
--  "Record the rejection. A refusal you cannot show is a refusal you
--  cannot prove." The platform is answerable for what it publishes;
--  being able to produce the log of what it declined to make is the
--  difference between a policy and a claim.
--
--  The prompt is stored in full, and that is the deliberate choice
--  rather than the lazy one. A hash proves a refusal occurred and
--  nothing about what was refused, which is precisely the question an
--  investigator asks. It is the user's own submitted text, held for the
--  same reason a bank keeps a declined transaction.
--
--  No foreign key to the rule: a rule deleted next year must not take
--  the evidence of last year's refusal with it. The id is kept for
--  joining while it exists, and the phrase is copied for when it does not.
-- ---------------------------------------------------------------------
CREATE TABLE prompt_rejections (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id     uuid REFERENCES accounts(id) ON DELETE SET NULL,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  rule_id        uuid,
  -- Copied, not joined. See above.
  matched_phrase text NOT NULL,
  category       text NOT NULL,
  prompt         text NOT NULL,
  -- 'quote' is a price request, 'job' a submission. Both carry a prompt
  -- and both are refused; which one it was says whether the person was
  -- still deciding or had committed.
  surface        text NOT NULL CHECK (surface IN ('quote','job')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prompt_rejections_account_idx ON prompt_rejections (account_id, created_at DESC);
CREATE INDEX prompt_rejections_recent_idx ON prompt_rejections (created_at DESC);


-- ---------------------------------------------------------------------
--  3. That the user agreed to the terms
--
--  The undertaking the owner signs to eNamad should be backed by one the
--  user signed to DEEV. A boolean would answer "did they agree" and not
--  "to what" -- terms change, and the version somebody accepted is the
--  only one they can be held to.
--
--  Nullable, because every account that exists today predates the
--  checkbox. Backfilling a consent nobody gave would be a lie in a
--  column whose whole purpose is to be true.
-- ---------------------------------------------------------------------
ALTER TABLE users ADD COLUMN terms_accepted_at timestamptz;
ALTER TABLE users ADD COLUMN terms_version text;

ALTER TABLE users ADD CONSTRAINT users_terms_pair_check
  CHECK (num_nonnulls(terms_accepted_at, terms_version) <> 1);


-- ---------------------------------------------------------------------
--  4. What a given member of staff may do
--
--  Permissions have always resolved from the role alone:
--
--      join roles r on r.code = ur.role_code
--      left join lateral jsonb_array_elements_text(r.permissions) ...
--
--  so the four seeded roles were the only four answers available, and
--  'admin' holds ["*"]. There was no way to hand somebody the moderation
--  queue and nothing else without inventing a role for them -- and no
--  API to do even that, only scripts/create-admin.ts on the server.
--
--  NULL keeps the old meaning exactly: inherit the role's set. A JSON
--  array narrows it for this one person. It can only ever narrow --
--  enforced in the application, which is the layer that knows who the
--  granter is and what they themselves hold.
-- ---------------------------------------------------------------------
ALTER TABLE user_roles ADD COLUMN permissions jsonb;

ALTER TABLE user_roles ADD CONSTRAINT user_roles_permissions_shape_check
  CHECK (permissions IS NULL OR jsonb_typeof(permissions) = 'array');

COMMENT ON COLUMN user_roles.permissions IS
  'NULL = inherit the role. An array = the exact set this person holds, always a subset of what their granter held.';
