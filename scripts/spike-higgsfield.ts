/**
 * Higgsfield reality check — the thing that turns the adapter from believed into
 * known.
 *
 *   1. put HIGGSFIELD_API_KEY in .env.local, as `<key-id>:<key-secret>`
 *   2. npx tsx scripts/spike-higgsfield.ts --price-only   # free: prices, no generation
 *   3. npx tsx scripts/spike-higgsfield.ts                # spends $0.0032
 *
 * `--price-only` stops before anything is generated. It is how the catalogue's
 * coin prices are re-derived when Higgsfield moves a rate or a promotion ends,
 * and it needs no credit on the account, only a valid credential.
 *
 * `packages/adapters/src/providers/higgsfield.ts` is written from documentation
 * rather than from a call that returned 200, which is the one thing
 * `providers/index.ts` argues against. This is how that debt gets paid, and until
 * it has been run every `model_routes` row pointing at Higgsfield stays inactive.
 *
 * It costs **$0.0032** — one Soul 2 image, the cheapest thing in either
 * catalogue — and stops at the first surprise, so a wrong assumption costs a
 * third of a cent rather than the balance.
 *
 * What it settles, none of which the documentation answers on its own:
 *   - whether `Authorization: Key <id>:<secret>` is accepted with the pair held
 *     in one environment variable, which is how ours is stored
 *   - whether the submit response really puts `request_id` at the top level
 *     rather than under a `data` envelope, as KIE and WaveSpeed both do
 *   - which statuses actually occur, and in what order
 *   - whether a completed image result is `images: [{url}]` as documented
 *   - whether ANY field reports what the request cost. The adapter records null
 *     because none is documented, and null is expensive to be wrong about: it
 *     makes every settlement fall back to the quote's estimate
 *   - what `POST /estimate/<mode>` answers, which is what the catalogue's coin
 *     prices are derived from, and whether it is free as documented
 *   - what a 422 body looks like, so the message summariser is right
 *   - that each mode in scripts/higgsfield-schemas/ resolves at all. A GET tells
 *     you nothing — every path on api.higgsfield.ai answers 405, including
 *     `/totally/made/up/path` — so the estimate endpoint is the only cheap probe
 *     there is.
 *
 * Every raw response is written to scripts/spike-out/ for reading afterwards.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setDefaultResultOrder } from "node:dns";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

/** See the note in scripts/crawl-higgsfield-schemas.ts: their AAAA record hangs. */
setDefaultResultOrder("ipv4first");

const BASE = "https://api.higgsfield.ai";
const OUT = join(process.cwd(), "scripts", "spike-out");
const CORPUS = join(process.cwd(), "scripts", "higgsfield-schemas");

/**
 * The cheapest real generation available anywhere in the catalogue.
 *
 * $0.0032 an image against Cinema Studio's $0.2057 a second. Deliberately not
 * the model we most want to ship: what this script proves is the lifecycle, the
 * auth header and the response shapes, and those are the same for every mode.
 */
const PROBE_MODE = "higgsfield-ai/soul/v2/standard";
const PROBE_INPUT = { prompt: "A single ripe pomegranate on a plain linen cloth, editorial studio light" };

/**
 * Higgsfield's own preview media, used as sample inputs.
 *
 * `POST /estimate/<mode>` validates a body before it prices it, so a mode that
 * takes a video cannot be priced with a prompt alone: it answers 400 saying
 * video_url is a required property. These two URLs come from the catalogue's own
 * `preview_video` field, so they are public, reachable from Higgsfield's side,
 * and cost nothing to host. Price depends on duration and resolution, not on
 * what the media depicts.
 */
const SAMPLE_IMAGE =
  "https://d28lhcrx5qdowv.cloudfront.net/media/explore/media/24fc2ccb2207a9d37b094f6da28c9055d73e98a02dddfa8d3b1c7d17b05865d8-thumbnail.webp";
const SAMPLE_VIDEO =
  "https://d28lhcrx5qdowv.cloudfront.net/media/explore/media/cf76b0c05e5ac8154b16bd24238d7527c837452db713691fa6d9db4bea7a7b3d-video.mp4";

/**
 * One body per mode that satisfies its schema, and the settings worth pricing.
 *
 * The grid matters more than it looks. Marketing Studio answered **$0.013** at
 * `quality: low, resolution: 1k` and **$0.542** at `high, 4k` — a 42-fold spread
 * on one mode — so there is no such thing as "the price of Marketing Studio",
 * and `model_prices.selector` is what DEEV already has for exactly this.
 */
const PRICE_PROBES: { mode: string; label: string; input: Record<string, unknown> }[] = [
  { mode: "higgsfield-ai/soul/v2/standard", label: "720p", input: { prompt: "a portrait", resolution: "720p" } },
  { mode: "higgsfield-ai/soul/v2/standard", label: "1080p", input: { prompt: "a portrait", resolution: "1080p" } },
  { mode: "higgsfield-ai/soul/standard", label: "720p", input: { prompt: "a portrait", resolution: "720p" } },
  { mode: "higgsfield-ai/soul/standard", label: "1080p", input: { prompt: "a portrait", resolution: "1080p" } },
  { mode: "marketing-studio/image", label: "low 1k", input: { prompt: "a bottle", quality: "low", resolution: "1k" } },
  { mode: "marketing-studio/image", label: "medium 2k", input: { prompt: "a bottle", quality: "medium", resolution: "2k" } },
  { mode: "marketing-studio/image", label: "high 4k", input: { prompt: "a bottle", quality: "high", resolution: "4k" } },
  {
    mode: "kling-video/omni/first-last-frame",
    label: "pro 5s",
    input: { prompt: "a slow push in", first_frame_url: SAMPLE_IMAGE, duration: 5, mode: "pro", aspect_ratio: "16:9" },
  },
  {
    mode: "kling-video/omni/first-last-frame",
    label: "std 10s",
    input: { prompt: "a slow push in", first_frame_url: SAMPLE_IMAGE, duration: 10, mode: "std", aspect_ratio: "16:9" },
  },
  {
    mode: "kling-video/o3/first-last-frame",
    label: "pro 5s",
    input: { prompt: "a slow push in", first_frame_url: SAMPLE_IMAGE, duration: 5, mode: "pro", aspect_ratio: "16:9" },
  },
  {
    mode: "kling-video/o3/first-last-frame",
    label: "4k 10s",
    input: { prompt: "a slow push in", first_frame_url: SAMPLE_IMAGE, duration: 10, mode: "4k", aspect_ratio: "16:9" },
  },
  {
    mode: "higgsfield/genjutsu/motion-transfer/v1.0",
    label: "720p",
    input: { video_url: SAMPLE_VIDEO, image_urls: [SAMPLE_IMAGE], resolution: "720p" },
  },
  {
    mode: "higgsfield/genjutsu/object-swap/v1.0",
    label: "720p",
    input: { video_url: SAMPLE_VIDEO, image_urls: [SAMPLE_IMAGE], resolution: "720p" },
  },
  { mode: "higgsfield/cinema-studio/4.0", label: "720p 5s", input: { prompt: "a coastal road", duration: 5, resolution: "720p" } },
];

/** Stops after the prices, which cost nothing and need no balance. */
const priceOnly = process.argv.slice(2).includes("--price-only");

const key = process.env.HIGGSFIELD_API_KEY?.trim();
if (!key) throw new Error("HIGGSFIELD_API_KEY is not set. Put it in .env.local — never in .env, which is committed-adjacent.");
if (!key.includes(":")) {
  throw new Error("HIGGSFIELD_API_KEY must be `<key-id>:<key-secret>` — the whole pair, exactly as it follows `Authorization: Key `.");
}

mkdirSync(OUT, { recursive: true });

let step = 0;

function save(name: string, data: unknown): void {
  step += 1;
  const file = `higgsfield-${String(step).padStart(2, "0")}-${name}.json`;
  writeFileSync(join(OUT, file), JSON.stringify(data, null, 2), "utf8");
  console.log(`    → scripts/spike-out/${file}`);
}

function die(what: string, detail: unknown): never {
  console.error(`\n✗ ${what}`);
  console.error(JSON.stringify(detail, null, 2).slice(0, 4_000));
  process.exit(1);
}

async function call(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown; correlationId: string | null }> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Key ${key}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { nonJson: text.slice(0, 4_000) };
  }
  return { status: response.status, body, correlationId: response.headers.get("x-correlation-id") };
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * What an estimate's answer tells us about a mode, never guessed from the status
 * alone.
 *
 * This is the lesson `spike-wavespeed.ts` paid for: reading only the status code
 * made it report all four seeded paths as existing when two of them did not.
 * Anything unrecognised is reported as unclear rather than passed.
 */
function verdictOf(status: number, body: unknown): string {
  const record = asRecord(body);
  const detail = typeof record.detail === "string" ? record.detail : "";
  if (status === 200 && typeof record.credits !== "undefined") return `exists — ${String(record.credits)} credits / $${String(record.usd)}`;
  if (status === 404) return "MISSING — no such mode for this account";
  if (status === 403) return "unclear (insufficient credits to price it)";
  if (status === 401) return "unclear (credentials rejected)";
  if (status === 422 || status === 400) return `unclear (${status}: ${detail || "body rejected"}) — the mode exists, these inputs do not`;
  if (status === 423 || status === 503) return `unclear (${status}: model blocked or not ready)`;
  return `unclear (${status})`;
}

function savedModes(): string[] {
  try {
    return (JSON.parse(readFileSync(join(CORPUS, "index.json"), "utf8")) as { modes: { mode: string }[] }).modes.map((mode) => mode.mode);
  } catch {
    die("no crawled corpus", "run `pnpm higgsfield:schemas` first — this script prices what that found");
  }
}

/* ------------------------------------------------------------------ 0. auth */

console.log("\n0. the credential is accepted at all");
{
  // Priced, not submitted: the estimate endpoint is the cheapest thing that
  // needs the header to be right, and a 401 here means nothing further is worth
  // trying.
  const { status, body, correlationId } = await call(`${BASE}/estimate/${PROBE_MODE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(PROBE_INPUT),
  });
  save("estimate-probe", { status, body, correlationId });
  if (status === 401) die("Authorization: Key <id>:<secret> was rejected", body);
  console.log(`   HTTP ${status} — ${verdictOf(status, body)}`);
  console.log(`   x-correlation-id: ${correlationId ?? "(absent — the adapter stores it when present)"}`);
}

/* ------------------------------------------------- 1. every mode we will seed */

console.log("\n1. what each mode costs, priced rather than run");
{
  const priced: Record<string, unknown> = {};
  for (const probe of PRICE_PROBES) {
    const { status, body } = await call(`${BASE}/estimate/${probe.mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(probe.input),
    });
    const record = asRecord(body);
    priced[`${probe.mode} @ ${probe.label}`] = { status, input: probe.input, body };

    const where = `   ${probe.mode.padEnd(42)} ${probe.label.padEnd(10)}`;
    if (status === 200 && record.type === "description") {
      // Higgsfield declines to quote a number for a token-metered mode and hands
      // back the formula instead. Cinema Studio and Genjutsu both do this, so
      // their coin prices are computed from the published rate rather than read
      // off an estimate. The formula is saved with the run.
      console.log(`${where} formula, not a number — priced from pricing_description`);
    } else if (status === 200 && typeof record.usd !== "undefined") {
      const discount = asRecord(record.discount);
      const promo = typeof discount.usd === "string" ? ` (promo $${discount.usd}, -${String(discount.percentage)}%)` : "";
      console.log(`${where} $${String(record.usd)} list${promo}`);
    } else {
      console.log(`${where} ${verdictOf(status, body)}`);
    }
  }
  save("prices", priced);

  // A mode in the corpus with no probe here is a mode nobody has priced, and it
  // would reach the catalogue with a price somebody guessed.
  const probed = new Set(PRICE_PROBES.map((probe) => probe.mode));
  const unpriced = savedModes().filter((mode) => !probed.has(mode));
  if (unpriced.length > 0) console.warn(`   ! crawled but never priced: ${unpriced.join(", ")}`);

  console.log("\n   List prices are what DEEV's margin is computed from, not the promo ones:");
  console.log("   the discount expires 2026-10-01 and a 2x margin set against it becomes 1.4x that day.");
}

if (priceOnly) {
  console.log("\n--price-only: stopping before anything is generated. Nothing was charged.");
  process.exit(0);
}

/* ------------------------------------------------------- 2. one real generation */

console.log(`\n2. one real ${PROBE_MODE} image — this is the part that costs money`);
const requestId = await (async () => {
  const { status, body, correlationId } = await call(`${BASE}/${PROBE_MODE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(PROBE_INPUT),
  });
  save("submit", { status, body, correlationId });
  const record = asRecord(body);

  // The assumption most likely to be wrong, and the cheapest to check: both
  // other providers nest their id under `data`.
  if (typeof record.request_id !== "string" || record.request_id === "") {
    die(`submit returned no top-level request_id (HTTP ${status})`, body);
  }
  console.log(`   HTTP ${status}  request_id ${record.request_id}  status "${String(record.status)}"`);
  if (typeof record.status_url === "string" && !record.status_url.endsWith(`/requests/${record.request_id}/status`)) {
    console.warn(`   ! status_url is not the path the adapter rebuilds: ${record.status_url}`);
  }
  return record.request_id;
})();

/* ------------------------------------------------------------- 3. the lifecycle */

console.log("\n3. polling to a terminal status");
{
  const seen: string[] = [];
  const started = Date.now();
  let terminal: Record<string, unknown> | null = null;

  // Their documented strategy: start at two seconds, back off to ten, add
  // jitter. The ten-minute ceiling is ours — a Soul image that has not finished
  // in ten minutes is a finding, not a slow day.
  for (let delay = 2_000; Date.now() - started < 10 * 60_000; delay = Math.min(delay * 1.5, 10_000)) {
    const { status, body } = await call(`${BASE}/requests/${encodeURIComponent(requestId)}/status`);
    const record = asRecord(body);
    const state = String(record.status ?? "");
    if (seen.at(-1) !== state) {
      seen.push(state);
      console.log(`   ${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s  HTTP ${status}  ${state}`);
    }
    if (["completed", "failed", "nsfw", "canceled"].includes(state)) {
      terminal = record;
      break;
    }
    if (status >= 400) die(`status answered ${status}`, body);
    await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * 500));
  }

  if (!terminal) die("no terminal status inside ten minutes", { requestId, seen });
  save("terminal", { seen, terminal });
  console.log(`   statuses in order: ${seen.join(" → ")}`);

  if (terminal.status !== "completed") {
    die(`ended ${String(terminal.status)} — read the saved body before trusting the adapter's mapping`, terminal);
  }

  /* ------------------------------------------------- 4. the shapes we assumed */

  console.log("\n4. the response shapes the adapter reads");
  const images = Array.isArray(terminal.images) ? terminal.images : null;
  if (!images || images.length === 0) die("completed with no `images` array — the adapter reads images/video/audio", terminal);
  const first = asRecord(images[0]);
  if (typeof first.url !== "string") die("`images[0].url` is not a string", terminal);
  console.log(`   images[0].url  ${String(first.url).slice(0, 96)}`);

  // The one that decides whether every Higgsfield settlement falls back to the
  // quote's estimate. Printed either way, because a field that appears later is
  // worth noticing.
  const costKeys = Object.keys(terminal).filter((name) => /credit|cost|usd|price|billed/i.test(name));
  console.log(
    costKeys.length > 0
      ? `   a cost IS reported (${costKeys.join(", ")}) — the adapter's null providerUnitsCost should be revisited`
      : "   no cost field in the terminal body — the adapter's null is correct, settlement uses the quote",
  );
  console.log(`   every key: ${Object.keys(terminal).join(", ")}`);
}

/* ----------------------------------------------- 5. a refusal, costing nothing */

console.log("\n5. a body they must reject, to check the error shape");
{
  const { status, body } = await call(`${BASE}/${PROBE_MODE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "", resolution: "8k", batch_size: 99 }),
  });
  save("rejected", { status, body });
  const record = asRecord(body);
  console.log(`   HTTP ${status}  detail is ${Array.isArray(record.detail) ? `a list of ${record.detail.length}` : typeof record.detail}`);
  if (status === 200) die("a body that should have been rejected was accepted — it may have cost money", body);
  console.log("   rejected before generating, so it cost nothing");
}

console.log("\n✅ the adapter's assumptions hold against the live API.");
console.log("   Routes may now be activated one at a time in the admin panel.");
