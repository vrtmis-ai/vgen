-- ---------------------------------------------------------------------
--  Music and sound effects
--
--  0014 left these out on purpose: no model in the catalogue made music or
--  effects, and a feature with no route is a section of the product that
--  does not exist. Suno now makes both, through KIE.
--
--  Two codes rather than 0014's single audio_generate. A song and a door
--  knock are different things to ask for, the audio studio gives each its
--  own tab, and the navigation groups by feature code — one code would put
--  a sound effect in the music column.
-- ---------------------------------------------------------------------
INSERT INTO features (code, name, modality, sort_order) VALUES
  ('music_generate', 'Generate Music',         'audio', 62),
  ('sound_generate', 'Generate Sound Effects', 'audio', 64)
ON CONFLICT (code) DO NOTHING;
