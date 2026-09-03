import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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
  /** Resolves a hostname to addresses. Injected so tests need no DNS. */
  resolve?: (hostname: string) => Promise<string[]>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const defaultResolve = async (hostname: string): Promise<string[]> => (await lookup(hostname, { all: true })).map((entry) => entry.address);

/**
 * Whether an address belongs to this machine, this network, or nobody.
 *
 * Everything a provider could name that is not a place on the public internet:
 * loopback, the RFC1918 ranges, carrier-grade NAT, multicast, and — the one
 * that matters most on a cloud VPS — 169.254.0.0/16, which is where instance
 * metadata services live and hand out credentials to anything that asks.
 */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = [parts[0]!, parts[1]!];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return a >= 224;
  }
  const address = ip.toLowerCase();
  if (address === "::" || address === "::1") return true;
  // Link-local (fe80::/10) and the unique-local block (fc00::/7).
  if (address.startsWith("fe80") || address.startsWith("fc") || address.startsWith("fd")) return true;
  // IPv4-mapped, in both spellings. `new URL()` rewrites the readable
  // `::ffff:127.0.0.1` into `::ffff:7f00:1`, so checking only the dotted form
  // silently lets every mapped private address through — which is exactly what
  // the test for this caught.
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (dotted) return isPrivateAddress(dotted[1]!);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (!hex) return false;
  const [high, low] = [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16)];
  return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
}

export class HttpOutputMirror implements OutputMirrorPort {
  private readonly store: ObjectStore;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly attempts: number;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly resolve: (hostname: string) => Promise<string[]>;

  constructor(options: HttpOutputMirrorOptions) {
    this.store = options.store;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.attempts = options.attempts ?? 3;
    this.maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.resolve = options.resolve ?? defaultResolve;
  }

  async mirror(source: GenerationOutput, target: MirrorTarget): Promise<JobOutput> {
    // Before the retry loop, not inside it: a URL naming somewhere private will
    // still name somewhere private in two seconds, and the job should fail on
    // the first look rather than sleep between three identical refusals.
    await this.assertPublic(source.url);

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

  /**
   * Refuses to fetch anything that is not a public web address.
   *
   * This is the one place the worker retrieves a URL it did not construct. The
   * address comes out of the provider's own JSON — `resultUrls` for KIE,
   * `outputs` for WaveSpeed — and is used verbatim, by a process sitting on the
   * compose network beside Postgres, Redis and MinIO, none of which publish a
   * port. So a provider that is compromised, spoofed, or merely wrong could
   * name `http://minio:9000/...` or the cloud metadata service, and the worker
   * would fetch it and file the answer as the customer's generated file.
   *
   * Not exploitable by a customer today — nothing they send reaches this string
   * — which is why this is a blast-radius control rather than a patch. It is
   * cheap: one DNS lookup on a path that is about to make a network request
   * anyway.
   *
   * A hostname resolved here could in principle resolve to something else on
   * the fetch a moment later. Closing that properly means pinning the address
   * and carrying the original `Host`, which `fetch` will not do; this raises
   * the bar from "any internal service" to "win a DNS race", and the rest of
   * the defence is that these services are not reachable from outside at all.
   */
  private async assertPublic(url: string): Promise<void> {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new Error("the provider returned a result address that is not a URL");
    }
    // Blocks file:, data: and gopher: among others; only the web is expected.
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      throw new Error(`the provider returned a ${target.protocol} result address, which is not fetched`);
    }

    // A bracketed IPv6 literal arrives with its brackets still on.
    const hostname = target.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname) ? [hostname] : await this.resolve(hostname);
    if (addresses.length === 0) throw new Error("the provider's result address does not resolve");
    // Every address, not the first: a name that answers with one public and one
    // private address is the interesting case, not an accident.
    if (addresses.some(isPrivateAddress)) {
      throw new Error("the provider's result address points inside our own network and was not fetched");
    }
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
