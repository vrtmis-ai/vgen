// Community feed: creations users chose to share into the mini app.
// Mock data for now (real shared posts come from the backend). Tapping a post
// opens its model with the prompt pre-filled ("make one like this").

export interface CommunityPost {
  id: string;
  familyId: string;
  prompt: string;
  seed: string;
  w: number;
  h: number;
  author: string;
  likes: number;
}

export const COMMUNITY: CommunityPost[] = [
  { id: "c1", familyId: "seedance", prompt: "A lone astronaut drifting past a neon space station, slow cinematic dolly", seed: "vgen-astro", w: 16, h: 9, author: "reza.vfx", likes: 1284 },
  { id: "c2", familyId: "nano-banana", prompt: "Hyperreal portrait of an elderly Persian calligrapher, warm window light", seed: "vgen-calli", w: 3, h: 4, author: "atelier.sahar", likes: 2061 },
  { id: "c3", familyId: "ideogram", prompt: "Bold typographic poster reading TEHRAN, bauhaus grid, crimson and ink", seed: "vgen-poster", w: 3, h: 4, author: "pixel_arman", likes: 873 },
  { id: "c4", familyId: "seedream", prompt: "Cyberpunk night market in the rain, reflective neon puddles, shallow depth", seed: "vgen-cyber", w: 16, h: 9, author: "neon.kourosh", likes: 3402 },
  { id: "c5", familyId: "kling", prompt: "A paper boat racing down a rushing gutter after rain, macro, soft focus", seed: "vgen-boat", w: 9, h: 16, author: "baran.render", likes: 1547 },
  { id: "c6", familyId: "gpt-image", prompt: "Isometric tiny cozy bookstore on a rainy corner, pastel palette, detailed", seed: "vgen-shop", w: 1, h: 1, author: "studio_aaye", likes: 992 },
  { id: "c7", familyId: "flux", prompt: "Dramatic basalt coastline at golden hour, volumetric light, long exposure", seed: "vgen-coast", w: 16, h: 9, author: "kavé.studio", likes: 2790 },
  { id: "c8", familyId: "qwen", prompt: "Loose watercolor fox curled in an autumn forest, paper grain", seed: "vgen-fox", w: 1, h: 1, author: "niloo.creates", likes: 1183 },
  { id: "c9", familyId: "imagen", prompt: "Studio shot of a faceted glass perfume bottle on a silk gradient", seed: "vgen-perfume", w: 1, h: 1, author: "darkroom.h", likes: 1620 },
  { id: "c10", familyId: "veo", prompt: "Timelapse of desert flowers blooming at dawn, vivid, shallow focus", seed: "vgen-bloom", w: 16, h: 9, author: "mahsa.makes", likes: 2455 },
];
