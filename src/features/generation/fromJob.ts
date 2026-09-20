import type { Family } from "../../data/models";
import type { GenerationJob } from "../../runtime/contracts/generation";
import type { Generation, GenStatus } from "../../lib/gallery";

/**
 * A server job, as the gallery draws it.
 *
 * The database has always held every generation an account made — who made it,
 * what it cost, which model ran it, and where the file went. The gallery read
 * `localStorage` instead, so signing in on a second device, or clearing site
 * data, showed an empty wall over a full table. This is the translation that
 * was missing.
 *
 * The job carries what happened; the catalogue carries what it looks like. A
 * family that has since left the catalogue still renders — with its own id as
 * the name and a neutral background — because a generation somebody paid for
 * should not vanish when we retire a model.
 */
export function generationFromJob(job: GenerationJob, families: readonly Family[]): Generation {
  const family = families.find((candidate) => candidate.id === job.familyId);
  const output = job.outputs[0];
  const kind = output?.kind === "video" || output?.kind === "audio" ? output.kind : (family?.kind ?? "image");

  /* The measured size wins wherever there is one, and every finished row has
     one. This only shapes the placeholder box for a row with no file yet, where
     a square for stills and 16:9 for motion is the shape each is usually asked
     for. The requested aspect does now arrive in `job.params` — it is carried
     below for "generate again" rather than read here, because what a frame
     should look like is a question the bytes answer better than the order did. */
  const [w, h] = output?.width && output.height ? [output.width, output.height] : kind === "image" ? [1, 1] : [16, 9];

  const status: GenStatus =
    job.status === "succeeded"
      ? "done"
      : job.status === "failed" || job.status === "cancelled" || job.status === "expired"
        ? "failed"
        : "running";

  return {
    // The job id is the identity here. A generation this browser started also
    // has a local key, and the merge keeps that one so an open result page does
    // not lose its subject mid-session.
    id: job.id,
    jobId: job.id,
    familyId: job.familyId,
    variantId: job.variantId,
    name: family?.name ?? job.familyId,
    vendor: family?.vendor ?? "",
    grad: family?.grad ?? "var(--vg-surface)",
    kind,
    prompt: job.prompt,
    params: job.params,
    ...(Object.keys(job.referenceAssetIds).length > 0 ? { refAssetIds: job.referenceAssetIds } : {}),
    w,
    h,
    ...(output?.width && output.height ? { outW: output.width, outH: output.height } : {}),
    ...(output?.durationMs ? { durationMs: output.durationMs } : {}),
    ...(output?.url ? { outputUrl: output.url } : {}),
    ...(job.outputs.length > 1 ? { moreOutputs: moreOutputsOf(job) } : {}),
    ...(output?.assetId ? { outputAssetId: output.assetId } : {}),
    ...(output?.url && job.urlsExpireAt ? { outputUrlExpiresAt: job.urlsExpireAt } : {}),
    status,
    ...(job.error ? { error: job.error } : {}),
    createdAt: job.createdAt,
  };
}

/** The outputs after the first — a Suno request's second take. See `moreOutputs`. */
export function moreOutputsOf(job: GenerationJob): NonNullable<Generation["moreOutputs"]> {
  return job.outputs.slice(1).map((output) => ({ url: output.url, ...(output.durationMs ? { durationMs: output.durationMs } : {}) }));
}

/**
 * The account's generations, from both places they live.
 *
 * The server is the record; the local list is what this tab has started and the
 * server may not have answered about yet. So a row present in both takes the
 * server's facts and the local row's identity — the id an open `/result/:id`
 * page is already holding — and a row present only locally survives, because it
 * is a submission in flight rather than a stale copy.
 */
export function mergeGenerations(local: readonly Generation[], server: readonly Generation[]): Generation[] {
  const localByJob = new Map(local.filter((gen) => gen.jobId).map((gen) => [gen.jobId!, gen]));
  const fromServer = server.map((gen) => {
    const mine = localByJob.get(gen.jobId!);
    return mine ? { ...gen, id: mine.id } : gen;
  });
  const known = new Set(server.map((gen) => gen.jobId));
  const localOnly = local.filter((gen) => !gen.jobId || !known.has(gen.jobId));
  return [...localOnly, ...fromServer].sort((left, right) => right.createdAt - left.createdAt);
}

/**
 * Whether two lists are the same generations in the same state.
 *
 * The merge runs on every render while the history query holds data, and
 * `mergeGenerations` builds a new array each time. Returning that unconditionally
 * would set state, re-render, merge again, and climb until React gives up with
 * "Maximum update depth exceeded" — the same trap the job-reconciliation effect
 * below it already guards against with object identity.
 *
 * Compares the fields that decide what a card draws. Deliberately not a deep
 * equality helper: the point is to answer "would the screen change", and a new
 * field that changes the screen should be added here on purpose.
 */
export function sameGenerations(left: readonly Generation[], right: readonly Generation[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((gen, index) => {
    const other = right[index]!;
    return (
      gen.id === other.id &&
      gen.jobId === other.jobId &&
      gen.status === other.status &&
      gen.outputUrl === other.outputUrl &&
      gen.outputAssetId === other.outputAssetId &&
      gen.outW === other.outW &&
      gen.outH === other.outH &&
      gen.durationMs === other.durationMs &&
      gen.moreOutputs?.[0]?.url === other.moreOutputs?.[0]?.url &&
      gen.error?.code === other.error?.code
    );
  });
}
