// Community feed: creations users chose to publish into the app.
//
// This used to be shaped as editorial content — a display handle and a picture.
// It is not: it is a moderated user submission, and the fields below are what
// the moderation queue and the admin panel are built out of.
//
// Three things here cannot be added later:
//
//  • `consentAt`. Publishing exposes the prompt, the settings and any reference
//    files the user uploaded. §14 requires their agreement to be taken at share
//    time — so for anything already published, a consent column added afterwards
//    has nothing truthful to put in it.
//  • `ownerUserId`. `author` is a display name; it cannot survive a rename and
//    cannot be joined to a wallet, a job, or an abuse report.
//  • `sourceGenerationId`. It is what makes a post recreatable, and it is what
//    the perceptual hash on a reel gets matched against.
//
// Reels are the reason `sourceGenerationId` is optional rather than required:
// the user assembles them from several shots outside the app, so there is no
// single generation behind one and no recreate button on one. Matching a reel to
// the uploader's library is a signal for a human, never an automatic gate —
// cropping, colour and transitions all move the hash, so a hard gate rejects
// real users.

/** Image and video are recreatable from one job; a reel is a showcase. */
export type CommunityCategory = "image" | "video" | "reel";

/** Every post is reviewed by an admin before it is public. */
export type PostStatus = "pending" | "approved" | "rejected";

export interface CommunityPost {
  id: string;
  /** Our user id. `author` below is a display name and is not an identity. */
  ownerUserId: string;
  /** The job this came from. Absent for reels, which have no single one. */
  sourceGenerationId?: string | undefined;
  category: CommunityCategory;
  status: PostStatus;
  /** When the user agreed to publish prompt, settings and reference files. */
  consentAt: number;
  familyId: string;
  prompt: string;
  seed: string;
  w: number;
  h: number;
  /** Display handle only — changeable, not a key. */
  author: string;
  likes: number;
}

// Fixed timestamps rather than Date.now(): mock rows that shift on every reload
// make it impossible to tell a rendering bug from a clock. Real rows come from
// the backend.
const T = Date.UTC(2026, 6, 20); // 2026-07-20
const DAY = 24 * 60 * 60 * 1000;

export const COMMUNITY: CommunityPost[] = [
  { id: "c1", ownerUserId: "u-101", sourceGenerationId: "g-c1", category: "video", status: "approved", consentAt: T - 12 * DAY, familyId: "seedance", prompt: "A lone astronaut drifting past a neon space station, slow cinematic dolly", seed: "vgen-astro", w: 16, h: 9, author: "reza.vfx", likes: 1284 },
  { id: "c2", ownerUserId: "u-102", sourceGenerationId: "g-c2", category: "image", status: "approved", consentAt: T - 11 * DAY, familyId: "nano-banana", prompt: "Hyperreal portrait of an elderly Persian calligrapher, warm window light", seed: "vgen-calli", w: 3, h: 4, author: "atelier.sahar", likes: 2061 },
  { id: "c3", ownerUserId: "u-103", sourceGenerationId: "g-c3", category: "image", status: "approved", consentAt: T - 10 * DAY, familyId: "ideogram", prompt: "Bold typographic poster reading TEHRAN, bauhaus grid, crimson and ink", seed: "vgen-poster", w: 3, h: 4, author: "pixel_arman", likes: 873 },
  { id: "c4", ownerUserId: "u-104", sourceGenerationId: "g-c4", category: "image", status: "approved", consentAt: T - 9 * DAY, familyId: "seedream", prompt: "Cyberpunk night market in the rain, reflective neon puddles, shallow depth", seed: "vgen-cyber", w: 16, h: 9, author: "neon.kourosh", likes: 3402 },
  { id: "c5", ownerUserId: "u-105", sourceGenerationId: "g-c5", category: "video", status: "approved", consentAt: T - 8 * DAY, familyId: "kling", prompt: "A paper boat racing down a rushing gutter after rain, macro, soft focus", seed: "vgen-boat", w: 9, h: 16, author: "baran.render", likes: 1547 },
  { id: "c6", ownerUserId: "u-106", sourceGenerationId: "g-c6", category: "image", status: "approved", consentAt: T - 7 * DAY, familyId: "gpt-image", prompt: "Isometric tiny cozy bookstore on a rainy corner, pastel palette, detailed", seed: "vgen-shop", w: 1, h: 1, author: "studio_aaye", likes: 992 },
  { id: "c7", ownerUserId: "u-107", sourceGenerationId: "g-c7", category: "image", status: "approved", consentAt: T - 6 * DAY, familyId: "flux", prompt: "Dramatic basalt coastline at golden hour, volumetric light, long exposure", seed: "vgen-coast", w: 16, h: 9, author: "kavé.studio", likes: 2790 },
  { id: "c8", ownerUserId: "u-108", sourceGenerationId: "g-c8", category: "image", status: "approved", consentAt: T - 5 * DAY, familyId: "qwen", prompt: "Loose watercolor fox curled in an autumn forest, paper grain", seed: "vgen-fox", w: 1, h: 1, author: "niloo.creates", likes: 1183 },
  { id: "c9", ownerUserId: "u-109", sourceGenerationId: "g-c9", category: "image", status: "approved", consentAt: T - 4 * DAY, familyId: "imagen", prompt: "Studio shot of a faceted glass perfume bottle on a silk gradient", seed: "vgen-perfume", w: 1, h: 1, author: "darkroom.h", likes: 1620 },
  // No sourceGenerationId: assembled by the user from several shots, so it has
  // no single job behind it and no recreate.
  { id: "c10", ownerUserId: "u-110", category: "reel", status: "approved", consentAt: T - 3 * DAY, familyId: "veo", prompt: "Timelapse of desert flowers blooming at dawn, vivid, shallow focus", seed: "vgen-bloom", w: 9, h: 16, author: "mahsa.makes", likes: 2455 },
];
