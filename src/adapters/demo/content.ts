import { z } from "zod";
import type { AppServices } from "../../runtime/AppServices";
import {
  CourseSchema,
  ExampleSchema,
  FeaturedItemSchema,
  PresetSchema,
  PromptFragmentSchema,
  SkillSchema,
  VoiceSchema,
} from "../../runtime/contracts/content";
import snapshot from "../../data/content.snapshot.json";

/**
 * The content demo mode serves, generated from Postgres rather than imported
 * from the seven TypeScript modules it replaced.
 *
 * Same argument as the catalog fixture beside it: `content.rows.json` is the
 * source a human edits and the API serves rows a seeder derived from it, so
 * reading the source here would mean demo mode renders the input to that
 * translation while production renders the output. Anything the seeder dropped
 * would look perfect in the mode screens are actually built in.
 *
 * It also means demo mode inherits the publish filter for free — the two draft
 * rows in the seed file are absent from this file because the repository that
 * wrote it excluded them.
 *
 * Regenerate with `pnpm content:publish && pnpm content:snapshot`.
 */
const collections = {
  presets: z.array(PresetSchema).parse(snapshot.presets),
  fragments: z.array(PromptFragmentSchema).parse(snapshot.fragments),
  skills: z.array(SkillSchema).parse(snapshot.skills),
  featured: z.array(FeaturedItemSchema).parse(snapshot.featured),
  courses: z.array(CourseSchema).parse(snapshot.courses),
  examples: z.array(ExampleSchema).parse(snapshot.examples),
  voices: z.array(VoiceSchema).parse(snapshot.voices),
};

export function createDemoContentService(now: () => number): AppServices["content"] {
  return {
    async list() {
      // Not from the file: the export leaves both out on purpose, because they
      // derive from row timestamps and would make the committed snapshot differ
      // on every run.
      return { version: "demo-content-v1", publishedAt: now(), ...collections };
    },
  };
}
