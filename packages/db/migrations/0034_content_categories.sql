-- =====================================================================
--  76. THE CATEGORIES, AS ROWS SOMEBODY CAN EDIT
--
--  The effects wall filters by five categories and the prompt bank by five
--  more. Both lists were zod enums with their Persian words in
--  src/features/content/labels.ts, which meant that adding a sixth shelf --
--  the most ordinary editorial act there is -- was a code change, a review
--  and a deploy. Everything *in* those shelves became editable in 0020 and
--  in the admin panel; the shelves themselves did not.
--
--  AN EIGHTH KIND, NOT AN EIGHTH TABLE. A category is a code, an order, a
--  publish state and a heading, which is precisely what content_items holds
--  -- and it already has the repository, the routes, the seeder, the public
--  document and the panel that a new table would each need a copy of. The
--  per-kind use of the shared columns:
--
--    category  the scope: 'preset' or 'prompt_fragment'. Which list this
--              belongs to, using the same column a course keeps its level in.
--    body      the slug the items point at ('camera', 'vfx'). Existing rows
--              already carry these values, so nothing about them moves.
--    title     the Persian label. Renaming it never touches an item.
--    subtitle  the bank's one-line explanation under its tabs.
--    sort_order  the order the tabs are drawn in.
--
--  The slug is deliberately NOT the code: 'camera' is a category in both
--  lists, and (kind, code) is unique. Codes are 'cat-preset-camera' and
--  'cat-bank-camera'; the slug is what an item stores, and it is unique
--  within its scope by the index below.
-- =====================================================================

ALTER TABLE content_items DROP CONSTRAINT content_items_kind_check;

ALTER TABLE content_items ADD CONSTRAINT content_items_kind_check CHECK (kind IN (
  'preset',           -- a complete prompt behind a picture (Effects)
  'prompt_fragment',  -- a craft term that appends to a prompt (Academy)
  'skill',            -- a multi-step workflow (Mcp)
  'featured',         -- the curated shelf (Explore)
  'course',           -- lessons, in Persian (Academy)
  'example',          -- an example output that pre-fills a model (Explore)
  'voice',            -- an ElevenLabs voice (Studio audio)
  'category'          -- a shelf the two lists above are filed under
));

-- One scope cannot hold two of the same slug: an item stores the slug alone,
-- so a duplicate would make "which shelf is this in?" unanswerable. Partial,
-- because every other kind leaves `body` free to repeat.
CREATE UNIQUE INDEX content_items_category_slug_idx
  ON content_items (category, body) WHERE kind = 'category';

COMMENT ON COLUMN content_items.body IS
  'The prompt or the fragment: what reaches the model. On a category row, the slug its items point at.';
COMMENT ON COLUMN content_items.category IS
  'Per-kind grouping an admin invents: a preset''s shelf, a course''s level. On a category row, which list it belongs to.';
