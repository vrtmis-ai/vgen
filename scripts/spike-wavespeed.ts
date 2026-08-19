/**
 * WaveSpeed reality check — the thing that turns the adapter from believed into
 * known.
 *
 *   1. put WAVESPEED_API_KEY in .env.local
 *   2. npx tsx scripts/spike-wavespeed.ts
 *
 * `packages/adapters/src/providers/wavespeed.ts` is written from published
 * documentation rather than from a call that returned 200, which is the one
 * thing `providers/index.ts` argues against. This script is how that debt gets
 * paid, and until it has been run every `model_routes` row pointing at
 * WaveSpeed stays inactive.
 *
 * It costs about $0.02 — one qwen-image generation — and stops at the first
 * surprise, so a wrong assumption costs two cents rather than the balance.
 *
 * What it settles, none of which the docs answer on their own:
 *   - whether the submit response really puts the id at `data.id`
 *   - which statuses actually occur, and in what order
 *   - whether `data.outputs` is a bare array of URL strings, as documented, or
 *     objects like most providers use
 *   - whether ANY field reports what the prediction cost — the adapter records
 *     null because none is documented, and null is expensive to be wrong about
 *   - what a 4xx body looks like, so the retryable/not-retryable split is right
 *   - that each path in src/data/routes.wavespeed.json resolves at all. Three of
 *     the four were transcribed from a naming convention, not read off a page.
 *
 * Every raw response is written to scripts/spike-out/ for reading afterwards.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import seed from "../src/data/routes.wavespeed.json" with { type: "json" };

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

const BASE = "https://api.wavespeed.ai";
const OUT = join(process.cwd(), "scripts", "spike-out");

const key = process.env.WAVESPEED_API_KEY?.trim();
if (!key) throw new Error("WAVESPEED_API_KEY is not set. Put it in .env.local — never in .env, which is committed-adjacent.");

mkdirSync(OUT, { recursive: true });

function save(name: string, data: unknown): void {
  writeFileSync(join(OUT, `wavespeed-${name}.json`), JSON.stringify(data, null, 2), "utf8");
}

function die(what: string, detail: unknown): never {
  console.error(`\n✗ ${what}`);
  console.error(JSON.stringify(detail, null, 2).slice(0, 4_000));
  process.exit(1);
}

async function call(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: response.status, body: { nonJson: text.slice(0, 2_000) } };
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const dataOf = (body: unknown) => asRecord(asRecord(body).data);

// ---------------------------------------------------------------- 1. paths
//
// Cheapest question first and it needs no generation: does each path we seeded
// exist at all? A wrong path is the most likely thing to be wrong, because
// three of the four were written from a convention rather than read off a page.

console.log("1. do the seeded model paths resolve?\n");
for (const route of seed.routes) {
  // A deliberately empty body. A path that exists answers 400 "missing prompt";
  // one that does not answers 404. Both are cheap and neither generates.
  const { status, body } = await call(`${BASE}/api/v3/${route.externalModelId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const verdict = status === 404 ? "MISSING" : status >= 500 ? "unclear (5xx)" : "exists";
  console.log(`   ${verdict.padEnd(14)} ${route.externalModelId}  (HTTP ${status})`);
  save(`path-${route.variantId}`, { status, body });
}

// ------------------------------------------------------------- 2. a real run
//
// qwen-image because it is the cheapest thing on the list at about two cents,
// and because it is the one route whose parameters were read off a real page.

const model = "wavespeed-ai/qwen-image/text-to-image";
console.log(`\n2. one generation on ${model}\n`);

const submitted = await call(`${BASE}/api/v3/${model}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "a small red boat on a calm sea, soft morning light", size: "1024*1024" }),
});
save("submit", submitted);

const id = dataOf(submitted.body).id;
if (typeof id !== "string" || !id) {
  die("submit did not return data.id — the adapter reads exactly this and would refuse every job", submitted);
}
console.log(`   submitted, id = ${id}`);
console.log(`   data.urls.get = ${JSON.stringify(asRecord(dataOf(submitted.body).urls).get)}`);

// ------------------------------------------------------------- 3. the states
//
// Recorded rather than asserted. The adapter treats anything it does not
// recognise as "still running", so the risk is not an unknown state — it is a
// terminal state we fail to recognise and poll forever.

console.log("\n3. polling\n");
const seen: string[] = [];
let final: unknown = null;

for (let attempt = 0; attempt < 60; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const polled = await call(`${BASE}/api/v3/predictions/${encodeURIComponent(id)}/result`);
  const record = dataOf(polled.body);
  const status = String(record.status ?? "");
  if (seen.at(-1) !== status) {
    seen.push(status);
    console.log(`   ${status}`);
  }
  if (["completed", "failed", "cancelled", "timeout"].includes(status)) {
    final = polled.body;
    break;
  }
}

if (!final) die("no terminal status inside two minutes", { seen });
save("result", final);

const record = dataOf(final);
const outputs = record.outputs;

console.log("\n4. what came back\n");
console.log(`   states seen:      ${seen.join(" -> ")}`);
console.log(`   outputs is:       ${Array.isArray(outputs) ? `array of ${typeof outputs[0]}` : typeof outputs}`);
console.log(`   first output:     ${JSON.stringify(Array.isArray(outputs) ? outputs[0] : outputs).slice(0, 120)}`);
console.log(`   every key on data: ${Object.keys(record).join(", ")}`);

// The adapter records providerUnitsCost as null and settlement falls back to
// the quote's estimate. If any of these is present that is wrong and worth
// fixing, because a reported cost is the real margin and an estimate is not.
const costKeys = Object.keys(record).filter((key) => /cost|credit|price|billing|usage/i.test(key));
console.log(`   cost-ish keys:    ${costKeys.length ? costKeys.join(", ") : "none — adapter's null is correct"}`);

if (Array.isArray(outputs) && outputs.length > 0 && typeof outputs[0] !== "string") {
  die("outputs is not an array of strings — `outputsFrom` in the adapter drops every non-string and would report no_output", outputs);
}

console.log("\n✓ shapes match the adapter. Raw responses in scripts/spike-out/.");
console.log("  Any path marked MISSING above must be corrected in src/data/routes.wavespeed.json before its route is activated.");
