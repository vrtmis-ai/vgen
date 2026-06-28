// Example outputs that seed the Explore feed. Tapping one opens its model with the
// prompt pre-filled. Images are placeholder photos (picsum) until we surface real
// community generations from the backend.

export interface ExploreItem {
  id: string;
  familyId: string;
  prompt: string;
  seed: string; // picsum seed
  w: number;
  h: number;
}

export const EXPLORE: ExploreItem[] = [
  { id: "e1", familyId: "seedance", prompt: "A lone astronaut drifting past a neon space station, slow cinematic dolly", seed: "vgen-astro", w: 16, h: 9 },
  { id: "e2", familyId: "nano-banana", prompt: "Hyperreal portrait of an elderly Persian calligrapher, warm window light", seed: "vgen-calli", w: 3, h: 4 },
  { id: "e3", familyId: "ideogram", prompt: "Bold typographic poster reading TEHRAN, bauhaus grid, crimson and ink", seed: "vgen-poster", w: 3, h: 4 },
  { id: "e4", familyId: "seedream", prompt: "Cyberpunk night market in the rain, reflective neon puddles, shallow depth", seed: "vgen-cyber", w: 16, h: 9 },
  { id: "e5", familyId: "kling", prompt: "A paper boat racing down a rushing gutter after rain, macro, soft focus", seed: "vgen-boat", w: 9, h: 16 },
  { id: "e6", familyId: "gpt-image", prompt: "Isometric tiny cozy bookstore on a rainy corner, pastel palette, detailed", seed: "vgen-shop", w: 1, h: 1 },
  { id: "e7", familyId: "flux", prompt: "Dramatic basalt coastline at golden hour, volumetric light, long exposure", seed: "vgen-coast", w: 16, h: 9 },
  { id: "e8", familyId: "qwen", prompt: "Loose watercolor fox curled in an autumn forest, paper grain", seed: "vgen-fox", w: 1, h: 1 },
  { id: "e9", familyId: "imagen", prompt: "Studio shot of a faceted glass perfume bottle on a silk gradient", seed: "vgen-perfume", w: 1, h: 1 },
  { id: "e10", familyId: "wan", prompt: "Timelapse of desert flowers blooming at dawn, vivid, shallow focus", seed: "vgen-bloom", w: 16, h: 9 },
];
