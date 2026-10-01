import { createS3ObjectStore, type ObjectStore, type S3ObjectStore } from "./objectStore";

/**
 * Reported when the second copy did not happen. Never thrown.
 *
 * `operation` rather than one flat message because the two failures mean
 * different things: `ensureBucket` at boot is a misconfiguration somebody can
 * fix before it costs anything, `put` is a file that now exists in one place
 * only.
 */
export interface BackupFailure {
  operation: "ensureBucket" | "put";
  bucket: string;
  key: string;
  error: string;
}

/**
 * The primary store, plus a second copy of everything written to it.
 *
 * `docs/DEPLOY.md` is honest that nothing backs up the volume the store writes
 * to, and every provider deletes its own originals within days — KIE after
 * fourteen. So one disk holds the only copy of every generation a customer has
 * paid for, and has done since the first one.
 *
 * Reads stay on the primary, deliberately. This is insurance, not a CDN:
 * serving from the far store would put every gallery image on somebody else's
 * bandwidth for no gain, and a store that appends its own `Content-Disposition`
 * stops the browser rendering the picture at all — which is measured, not
 * hypothetical.
 *
 * **A failed backup never fails the write.** The primary already holds the file
 * that was paid for, and failing the job to protect a spare copy would be the
 * wrong way round — in the worker that `put` sits inside a retry loop that pays
 * to download the provider's output again. So failures are reported, which is
 * why `onFailure` is an argument rather than a default: a backup that is quietly
 * doing nothing looks exactly like a backup.
 */
export function withBackupStore(primary: ObjectStore, backup: ObjectStore, onFailure: (failure: BackupFailure) => void): ObjectStore {
  const attempt = async (operation: BackupFailure["operation"], key: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      onFailure({ operation, bucket: backup.bucket, key, error: error instanceof Error ? error.message : "unknown" });
    }
  };

  return {
    bucket: primary.bucket,
    signedUrl: (key, expiresInSeconds, options) => primary.signedUrl(key, expiresInSeconds, options),
    // ponytail: not propagated. Nothing in the app deletes an object, and a
    // backup that honours deletes would also honour a bug that issues them.
    delete: (key) => primary.delete(key),

    async ensureBucket(): Promise<void> {
      await primary.ensureBucket();
      // At boot rather than on the first write, and best effort either way: a
      // bucket that does not exist, or credentials that cannot see it, is worth
      // one line in the startup log instead of one line per generation for the
      // life of the deployment.
      await attempt("ensureBucket", "", () => backup.ensureBucket());
    },

    async put(key, body, mimeType) {
      const stored = await primary.put(key, body, mimeType);
      // Awaited, not fired and forgotten: an unawaited promise in the worker
      // outlives the job that made it and can be cut off by a shutdown. The
      // cost of waiting is bounded by the backup client's own request timeout,
      // which is what the caller sets it for.
      await attempt("put", key, () => backup.put(key, body, mimeType));
      return stored;
    },
  };
}

/**
 * The backup store this deployment asks for, or nothing.
 *
 * Both processes that write objects need the same four variables read the same
 * way, so they are read here rather than twice over. No
 * `BACKUP_STORAGE_ENDPOINT` means no second copy, which is the local
 * arrangement and was the only arrangement until there was a second store to
 * name.
 *
 * Half-configured throws instead of quietly meaning "off". A typo in one
 * variable name would otherwise leave a deployment that believes it has a
 * backup and does not, and nothing afterwards would say so.
 */
export function backupStoreFrom(env: Record<string, string | undefined>): S3ObjectStore | undefined {
  const endpoint = env.BACKUP_STORAGE_ENDPOINT?.trim();
  if (!endpoint) return undefined;

  const bucket = env.BACKUP_STORAGE_BUCKET?.trim();
  const accessKeyId = env.BACKUP_STORAGE_ACCESS_KEY?.trim();
  const secretAccessKey = env.BACKUP_STORAGE_SECRET_KEY?.trim();
  const missing = [
    ...(bucket ? [] : ["BACKUP_STORAGE_BUCKET"]),
    ...(accessKeyId ? [] : ["BACKUP_STORAGE_ACCESS_KEY"]),
    ...(secretAccessKey ? [] : ["BACKUP_STORAGE_SECRET_KEY"]),
  ];
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(`${missing.join(", ")} required when BACKUP_STORAGE_ENDPOINT is set`);
  }

  return createS3ObjectStore({
    bucket,
    endpoint,
    region: env.BACKUP_STORAGE_REGION?.trim() || "us-east-1",
    credentials: { accessKeyId, secretAccessKey },
    // This store is on somebody else's network and the primary is not, while an
    // upload and a finished generation both wait on the put. The SDK's default
    // request timeout is none at all, so a store that stops answering would hang
    // the thing that was only ever taking a spare copy.
    requestHandler: { requestTimeout: 30_000, connectionTimeout: 5_000 },
  });
}
