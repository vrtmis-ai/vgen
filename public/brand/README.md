# Brand assets

## deev-mascot.png — NOT YET ADDED

The landing hero has a slot for it and renders correctly without it: the frame's
key light, the subject glow and the vignette are all painted, so the shot reads
as something standing in the dark even with no figure in it. Drop the file in as
`deev-mascot.png` and it appears — no code change.

What the slot expects:

- **Transparent PNG or WebP**, the figure cut out. The glow behind it is drawn by
  the page (`.vg-subject-glow`), so the file must not carry its own halo or a
  matte background — a baked-in glow on top of the painted one reads as a sticker.
- **Roughly 2:3 portrait**, full body, standing. It is sized to 86% of the frame
  height and bottom-anchored, so the feet want to be near the bottom edge of the
  canvas with little padding under them.
- **~1200px tall** is plenty. It renders at most ~560px wide on a desktop.
- The blue veins should stay as they are in the brand sheet — the page's accent
  is sampled from them (`--vg-primary-rgb: 0 180 255`), so they will agree.

If a video version exists later, the same slot takes it: swap the `img` in
`Hero` for a muted looping `video` and nothing else moves.
