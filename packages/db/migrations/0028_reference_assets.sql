-- ---------------------------------------------------------------------
--  The reference files a generation was asked to draw from
--
--  `POST /assets` has stored uploads since #27 and the browser has been
--  building a slot -> asset id map since #55. Nothing carried it: the HTTP
--  adapter did not put the field in the body and the request contract — which
--  is `.strict()` — had no field for it. So a customer could fill a first-frame
--  slot on a model that requires one, watch the upload succeed, and generate
--  something made from no reference at all, at full price. These two columns
--  are where that map finally lands.
--
--  Shape is `slot key -> ordered asset ids`:
--
--      {"first_frame_url": ["0199..."], "image_urls": ["0199...", "0199..."]}
--
--  The slot key is the catalogue's, which is also the upstream parameter name —
--  `image_urls`, `first_frame_url`, `driving_audio_url`. That is not a leak:
--  these keys are already public on `GET /catalog` because a screen has to
--  render a control per slot. It does mean the worker can merge signed URLs
--  straight into the provider payload under the same key, with no per-provider
--  mapping table to keep in step with the catalogue.
--
--  Order inside a slot is meaningful and is why this is an array rather than a
--  set: first and last frame are two entries in one slot on several video
--  models, and swapping them makes a different clip.
-- ---------------------------------------------------------------------

-- What was priced. Some models bill by what actually arrived, so the quote has
-- to record which files it was looking at when it named a number.
ALTER TABLE quotes ADD COLUMN reference_asset_ids jsonb
  CONSTRAINT quotes_reference_assets_shape_check
    CHECK (reference_asset_ids IS NULL OR jsonb_typeof(reference_asset_ids) = 'object');

-- ---------------------------------------------------------------------
--  And the job keeps its own copy
--
--  Exactly the argument 0018 makes for `jobs.entitlement_id`: the quote is the
--  decision, the job is what ran, and 0023 deletes expired quotes on a
--  schedule. "Which files went into this picture" has to stay answerable long
--  after the quote that priced them is gone — for support, for a moderation
--  question, and for the customer's own gallery.
-- ---------------------------------------------------------------------
ALTER TABLE jobs ADD COLUMN reference_asset_ids jsonb
  CONSTRAINT jobs_reference_assets_shape_check
    CHECK (reference_asset_ids IS NULL OR jsonb_typeof(reference_asset_ids) = 'object');

-- ---------------------------------------------------------------------
--  Why not job_inputs, which 0001 built for this
--
--  Because its `role` is a seven-value CHECK — source, reference, mask, style,
--  first_frame, last_frame, audio — written before the catalogue had slots, and
--  the eighteen slot keys in the catalogue today do not map onto it without
--  somebody inventing the mapping. `image_urls` is a reference; `input_urls` on
--  a video model is arguably a source; `first_clip_url` is neither cleanly.
--
--  That classification is a real question with a real answer, and it is also
--  not one that has to be settled to get a file to a provider. Guessing it now
--  would put eighteen invented facts in a column named `role` that nothing
--  reads, which is worse than leaving the table empty a while longer.
--
--  Its primary key would need changing too — (job_id, asset_id, role, position)
--  collides the moment one image is used in two different slots at position 0,
--  which is an ordinary thing to do with a face.
--
--  So `job_inputs` stays empty and stays correct. When something needs to ask
--  "which jobs used this asset" — moderation, or deleting an upload — that is
--  the table to fill, and the slot key recorded here is what it should be
--  filled from.
-- ---------------------------------------------------------------------
