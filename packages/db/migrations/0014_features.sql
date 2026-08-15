-- =====================================================================
--  64. THE FEATURES THE CATALOG ACTUALLY SELLS
--
--  0001 seeded five features from the schema's own design notes:
--  image_generate, image_edit, video_generate, image_to_video, chat.
--  Routing every variant in the catalog to one of them turned up two the
--  product ships and that list has no name for:
--
--    video_edit      topaz/video-upscale and wan/2-7-videoedit take a video
--                    in and give a video back. They are not generation and
--                    they are not image_edit; filing them under either would
--                    make jobs.feature_id a lie in the only place it is read.
--
--    speech_generate the two ElevenLabs models. modality 'audio', which no
--                    seeded feature had — the schema's five features cover
--                    image, video and text only.
--
--  Not seeded: audio_generate. The plan called for it alongside
--  speech_generate, but no model in the catalog produces music or effects,
--  and a feature with no route is a section of the product that does not
--  exist. It is one INSERT the day a model does.
--
--  ON CONFLICT because 0001 uses it for the same table, and re-running a
--  seed must never be the thing that breaks a deploy.
-- =====================================================================

INSERT INTO features (code, name, modality, sort_order) VALUES
  ('video_edit',      'Edit Video',      'video', 45),
  ('speech_generate', 'Generate Speech', 'audio', 60)
ON CONFLICT (code) DO NOTHING;
