import type { AppServices } from "../../runtime/AppServices";
import { FamilySchema } from "../../runtime/contracts/catalog";
import snapshot from "../../data/catalog.snapshot.json";
import { z } from "zod";

/**
 * The catalog demo mode serves, generated from Postgres rather than imported
 * from `src/data/models.ts`.
 *
 * The distinction matters: FAMILIES is the source a human edits, and the API
 * serves rows a seeder derived from it. Reading FAMILIES here would mean demo
 * mode renders the input to that translation while production renders the
 * output, so anything the seeder dropped would look perfect in the mode screens
 * are actually built in. The committed file is the seeder's output, re-exported
 * and diffed in CI, so the two modes show the same catalog by construction.
 *
 * Regenerate with `pnpm catalog:publish && pnpm catalog:snapshot`.
 */
const families = z.array(FamilySchema).parse(snapshot.families);

export function createDemoCatalogService(now: () => number): AppServices["catalog"] {
  return {
    async list() {
      // Not from the file: the export leaves both out on purpose, because they
      // derive from row timestamps and would make the committed snapshot differ
      // on every run.
      return { version: "demo-catalog-v1", publishedAt: now(), families };
    },
  };
}
