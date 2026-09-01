import { extensionFor, measure, type GenerationOutput, type ObjectStore } from "@vgen/adapters";
import type { JobOutput } from "@vgen/db";

/**
 * Takes a copy of what the provider made, before the link to it dies.
 *
 * Every provider we use answers with a URL that expires — KIE's within hours. A
 * gallery built on those URLs empties itself while nobody is looking, and the
 * customer paid for a file rather than for a loan of somebody else's copy of
 * one. So the worker downloads each output and puts it in our own store before
 * the job is allowed to count as finished.
 *
 * The retries matter more here than anywhere else in the runner, for a reason
 * specific to this step: it is the one thing that cannot be retried by running
 * the job again. Going back to `submit` would generate a second picture and pay
 * the provider twice for one the customer already has. So the download retries
 * in place, and if it still fails the job fails and the customer is refunded —
 * we eat the provider's charge. That is the correct side to lose on.
 */

export interface MirrorTarget {
  accountId: string;
  jobId: string;
  index: number;
}

export interface OutputMirrorPort {
  /** Fetch the provider's file and keep it, returning where it now lives. */
  mirror(source: GenerationOutput, target: MirrorTarget): Promise<JobOutput>;
}

export interface HttpOutputMirrorOptions {
  store: ObjectStore;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  /** Refuses anything larger, rather than filling a disk on one bad response. */
  maxBytes?: number;
  timeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class HttpOutputMirror implements OutputMirrorPort {
  private readonly store: ObjectStore;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly attempts: number;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;

  constructor(options: HttpOutputMirrorOptions) {
    this.store = options.store;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.attempts = options.attempts ?? 3;
    this.maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async mirror(source: GenerationOutput, target: MirrorTarget): Promise<JobOutput> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        const bytes = await this.download(source.url);
        // Keyed by job and position, never by hash: two outputs of one batch
        // can be byte-identical — same seed, same prompt — and both still
        // belong in the gallery as separate results.
        const key = `generated/${target.accountId}/${target.jobId}/${target.index}.${extensionFor(source.mimeType)}`;
        const stored = await this.store.put(key, bytes, source.mimeType);
        return {
          kind: source.kind,
          mimeType: stored.mimeType,
          bucket: stored.bucket,
          key: stored.key,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
          // Here rather than anywhere else because this is the only moment the
          // whole file is in memory. Reading it back out of the store to size it
          // would be a second download of something we were just holding.
          //
          // Never a reason to fail: a format this cannot read returns nulls,
          // which is what these columns held before it existed. Losing a
          // generation the customer paid for over an unreadable header would be
          // an absurd trade.
          ...measure(bytes),
        };
      } catch (error) {
        lastError = error;
        if (attempt < this.attempts) await this.sleep(attempt * 1_000);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("could not store the generated file");
  }

  private async download(url: string): Promise<Uint8Array> {
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new Error(`downloading the result failed with HTTP ${response.status}`);

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > this.maxBytes) throw new Error(`result is ${declared} bytes, over the ${this.maxBytes} limit`);

    const bytes = new Uint8Array(await response.arrayBuffer());
    // Checked again after reading: content-length is a claim, and a chunked
    // response does not make one at all.
    if (bytes.byteLength > this.maxBytes) throw new Error(`result is ${bytes.byteLength} bytes, over the ${this.maxBytes} limit`);
    if (bytes.byteLength === 0) throw new Error("the provider returned an empty file");
    return bytes;
  }
}
