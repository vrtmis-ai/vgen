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

// ------------------------------------------------------- 0. balance, and the
//                                                             model catalogue
//
// Both of these are free, and each answers a question that otherwise gets
// misread further down. A zero balance makes every submit fail for a reason
// that has nothing to do with our request shape; and GET /api/v3/models is the
// authoritative list, which turns "does this path exist" from a probe into a
// lookup. Neither endpoint is in WaveSpeed's own quickstart — both were found
// by asking.

const balance = await call(`${BASE}/api/v3/balance`);
const funds = Number(dataOf(balance.body).balance ?? Number.NaN);
console.log(`0. balance: ${Number.isFinite(funds) ? `$${funds}` : "unreadable"}\n`);
save("balance", balance);

const catalogue = await call(`${BASE}/api/v3/models`);
const listed = Array.isArray(asRecord(catalogue.body).data) ? (asRecord(catalogue.body).data as { model_id?: string }[]) : [];
if (listed.length === 0) die("GET /api/v3/models returned nothing usable — the path check below cannot be trusted", catalogue);
save("models", listed);
const known = new Set(listed.map((entry) => String(entry.model_id)));
console.log(`   ${listed.length} models listed by the provider\n`);

console.log("1. do the seeded model paths resolve?\n");

/**
 * WaveSpeed answers **400 "Model not found."** for a model it does not have,
 * not 404. A 404 here means the URL did not match their router at all — a
 * malformed path rather than a missing model.
 *
 * Reading only the status was this script's own bug, and it was an expensive
 * one: it reported all four seeded paths as "exists" when two of them did not,
 * which is precisely the fact the script was written to establish. Both the
 * message and the status are consulted now, and anything unrecognised is
 * reported as unclear rather than quietly passed.
 */
function verdictOf(status: number, body: unknown): string {
  const message = String(asRecord(body).message ?? "");
  if (status === 404 || /model not found/i.test(message)) return "MISSING";
  if (status >= 500) return "unclear (5xx)";
  // "field prompt is required" — the model exists and validated our empty body.
  if (/required|invalid request/i.test(message)) return "exists";
  // Insufficient credit is answered before validation on some paths, and it
  // says nothing either way about whether the model is real.
  if (/insufficient/i.test(message)) return "unclear (no credit)";
  return `unclear (${status})`;
}

let missing = 0;
for (const route of seed.routes) {
  // A deliberately empty body: a model that exists rejects it for a missing
  // prompt, and one that does not is named as missing. Neither generates.
  const { status, body } = await call(`${BASE}/api/v3/${route.externalModelId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  // The list is the authority; the POST is the corroboration. They have agreed
  // every time so far, and a disagreement is worth seeing rather than averaging.
  const verdict = known.has(route.externalModelId) ? "exists" : verdictOf(status, body);
  if (verdict === "MISSING") missing += 1;
  console.log(`   ${verdict.padEnd(20)} ${route.externalModelId}  (HTTP ${status}) ${String(asRecord(body).message ?? "")}`);
  save(`path-${route.variantId}`, { status, body, listedInCatalogue: known.has(route.externalModelId) });
}

if (missing > 0) {
  // Stop rather than spend. A seed file naming models that do not exist is the
  // finding; going on to generate would bury it under a success further down.
  die(`${missing} seeded path(s) name a model WaveSpeed does not have`, {
    fix: "correct src/data/routes.wavespeed.json against GET /api/v3/models, then re-run",
  });
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
  // Distinguish "no money" from "wrong shape". They arrive as the same 400 and
  // mean opposite things: one is a top-up, the other is a bug in the adapter.
  // Reporting the first as the second sends somebody looking for a fault that
  // is not there, which is what happened the first time this was run.
  if (/insufficient/i.test(String(asRecord(submitted.body).message ?? ""))) {
    console.log("   the account has no credit, so nothing below can run.\n");
    console.log("   Everything above is still settled: the key authenticates, the paths");
    console.log("   resolve, and the error envelope is the shape the adapter parses.");
    console.log("   What stays unproven is the success path — data.id, the polling");
    console.log("   states, and whether data.outputs is really an array of strings.");
    console.log("\n   Top up and re-run; it costs about $0.02 to settle the rest.");
    process.exit(0);
  }
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
