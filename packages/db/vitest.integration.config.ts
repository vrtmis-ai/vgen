import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    /**
     * One database, so one file at a time.
     *
     * Vitest runs test files in parallel because it assumes they are isolated.
     * These are not: they all talk to the same Postgres, several of them clear
     * a whole shared table inside their rollback transaction
     * (`delete from plans`, `delete from content_items`), and `raceHarness.ts`
     * commits rows on purpose — that is the only way to test a race between two
     * connections at all.
     *
     * Put those together and a file that has just emptied a table can watch
     * another file's committed row appear in it before the next statement,
     * because READ COMMITTED takes a fresh snapshot each time. That is not
     * hypothetical: `plansRepository` failed roughly one run in four this way,
     * and paired with the concurrency file it failed three times out of three.
     *
     * The suite goes from about two seconds to about ten. That is the price of
     * the tests meaning what they say.
     */
    fileParallelism: false,
  },
});
