-- =====================================================================
--  68. THE CONTENT THE PRODUCT IS MADE OF
--
--  Eight collections still lived as TypeScript constants in src/data:
--  presets, the prompt bank, skills, the featured shelf, courses, explore
--  examples and the voice list. Every one of them is content an admin
--  publishes, reorders and pulls — and every one of them needed a deploy to
--  change, which is the thing this whole schema exists to stop.
--
--  ONE TABLE, NOT SEVEN, and that is a decision worth defending.
--
--  These seven collections differ in their tails and agree on their spine.
--  All of them have a stable code, a publish state, a manual order, a
--  heading, a line of supporting text and — where they open something — the
--  model family they point at. What differs is small and per-kind: a course
--  has lessons, a skill has steps, an example has an aspect ratio.
--
--  Seven tables would mean seven repositories, seven routes, seven seeders
--  and seven admin screens to edit rows that an admin thinks about the same
--  way. One table with a `kind` discriminator means one of each, and the
--  panel is a single screen with a filter.
--
--  The per-kind tail lives in `payload`, validated by a discriminated Zod
--  union at both the write and the read. That is not a new idea here:
--  `provider_models.capabilities` has worked exactly this way since 0001,
--  parsed by CatalogCapabilitiesSchema, and the catalogue is a great deal
--  more load-bearing than a course list. Columns for what every kind has and
--  what queries filter on; jsonb for the tail.
--
--  WHAT IS NOT HERE. Community posts. They are user-generated, they carry
--  consent, ownership and a moderation state, and `posts` already models all
--  three since 0001. Editorial content and a user's submission are not the
--  same kind of thing and giving them one table would be the mistake this
--  file is otherwise avoiding.
-- =====================================================================

CREATE TABLE content_items (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),

  -- Which collection this row belongs to. The screens read one kind each.
  kind        text NOT NULL CHECK (kind IN (
                'preset',           -- a complete prompt behind a picture (Effects)
                'prompt_fragment',  -- a craft term that appends to a prompt (Academy)
                'skill',            -- a multi-step workflow (Mcp)
                'featured',         -- the curated shelf (Explore)
                'course',           -- lessons, in Persian (Academy)
                'example',          -- an example output that pre-fills a model (Explore)
                'voice'             -- an ElevenLabs voice (Studio audio)
              )),

  -- The id the screens have always keyed off — 'p1', 'c-start', or for a
  -- voice, ElevenLabs' own id. Stable across a re-seed, which is what lets
  -- an admin's edits survive one: the seeder matches on (kind, code).
  code        text NOT NULL,

  -- Exactly the three states src/data/content.ts defined, because the
  -- screens already read through `published()` and this is that filter.
  status      text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','published','archived')),
  sort_order  integer NOT NULL DEFAULT 0,

  -- The spine. `title` is null only for an example, which is a picture and a
  -- prompt with nothing to head it — the CHECK below says so rather than
  -- leaving every other kind's heading optional.
  title       text,
  subtitle    text,   -- blurb, note, the second line on a card
  body        text,   -- the prompt or the fragment: what reaches the model

  -- Free text rather than a lookup: these are per-kind groupings
  -- ('camera', 'vfx', 'beginner') that an admin invents alongside the row.
  category    text,

  -- Which model family this opens, when it opens one. Deliberately NOT a
  -- foreign key: a family is not a table, it is a `family` value shared by
  -- several `provider_models` rows, so there is nothing to reference. The
  -- seeder refuses a family_code that no active model carries, which is the
  -- same rule publish-pricing.ts enforces and the same reason — a row
  -- pointing at a model that does not exist is a dead card in the product.
  family_code text,

  -- Placeholder art key while real previews do not exist. When they do this
  -- becomes an assets(id) and this column goes.
  seed        text,

  -- The per-kind tail. See packages/contracts/src/content.ts for the union
  -- that is allowed in here; anything else is refused before it is written.
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,

  updated_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (kind, code),

  CONSTRAINT content_items_titled
    CHECK (kind = 'example' OR title IS NOT NULL),

  -- A preset with no prompt is a card that does nothing when tapped, and a
  -- fragment with no fragment is a word with nothing behind it. Both are
  -- failures that only show up when a user taps them, so they are refused
  -- at the column instead.
  CONSTRAINT content_items_bodied
    CHECK (kind NOT IN ('preset','prompt_fragment','example') OR body IS NOT NULL)
);

-- The only read the screens make: one kind, published, in the admin's order.
CREATE INDEX content_items_shelf_idx
  ON content_items (kind, sort_order ASC) WHERE status = 'published';

CREATE TRIGGER content_items_set_updated_at BEFORE UPDATE ON content_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE content_items IS
  'Editorial content an admin publishes: presets, prompt fragments, skills, the featured shelf, courses, examples and voices. User submissions live in posts.';
COMMENT ON COLUMN content_items.payload IS
  'Per-kind tail, validated by the discriminated union in packages/contracts/src/content.ts. Columns carry what every kind shares.';
COMMENT ON COLUMN content_items.family_code IS
  'provider_models.family, not a foreign key — a family is a shared column value, not a table. The seeder refuses unknown ones.';
