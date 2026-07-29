/**
 * KIE reality check — turns assumptions into facts before the backend is written.
 *
 *   1. copy .env.example to .env and put your key in it
 *   2. npx tsx scripts/spike-kie.ts
 *
 * Costs about 11.3 KIE credits in total and stops at the first failure, so a
 * wrong assumption costs half a credit rather than the whole balance.
 *
 * What it settles, none of which the documentation answers on its own:
 *   - which host actually serves file upload (the docs name two)
 *   - whether recordInfo really returns creditsConsumed, and whether it matches
 *     what the balance actually dropped by
 *   - which task states occur in practice
 *   - the real shape of resultJson
 *   - whether Topaz's upscale_factor maps to the rate table's 2K/4K/8K tiers the
 *     way the catalogue infers it does
 *
 * Every raw response is written to scripts/spike-out/ for reading afterwards.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";

const OUT = join(import.meta.dirname, "spike-out");
const API = "https://api.kie.ai";
// The stream-upload page's own curl says redpandaai; the OpenAPI servers block
// says api.kie.ai — but that block is identical on every page in their docs, so
// it is a project-wide default, not a claim about this endpoint. Try both.
const UPLOAD_HOSTS = ["https://kieai.redpandaai.co", "https://api.kie.ai"];

// ---------------------------------------------------------------- setup

function loadKey(): string {
  const fromEnv = process.env.KIE_API_KEY;
  if (fromEnv) return fromEnv;
  const envPath = join(import.meta.dirname, "..", ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^\s*KIE_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (m?.[1]) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  console.error("No KIE_API_KEY. Put it in .env at the repo root:\n\n  KIE_API_KEY=your-key-here\n");
  process.exit(1);
}

const KEY = loadKey();
const auth = { Authorization: `Bearer ${KEY}` };
let step = 0;

function save(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${String(++step).padStart(2, "0")}-${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

function die(what: string, detail: unknown): never {
  console.error(`\n✗ ${what}`);
  console.error(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
  console.error(`\nStopped here on purpose — nothing further runs, so nothing further is spent.`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- a real PNG
// Built here rather than committed so the script stays self-contained. Recraft
// rejects anything under 256px, so this is 256×256 with actual variation in it —
// an upscaler given one flat colour is not a meaningful test.

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

function makePng(size = 256): Buffer {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // no per-row filter
    for (let x = 0; x < size; x++) {
      raw[p++] = (x * 255) / size;
      raw[p++] = (y * 255) / size;
      raw[p++] = ((x ^ y) & 0x3f) * 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- KIE calls

async function balance(): Promise<number> {
  const res = await fetch(`${API}/api/v1/chat/credit`, { headers: auth });
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.data !== "number") die("balance check failed", body ?? (await res.text()));
  return body.data as number;
}

/** Tries each documented host and reports which one actually answers. */
async function upload(png: Buffer): Promise<{ host: string; url: string; raw: unknown }> {
  const attempts: Record<string, unknown> = {};
  for (const host of UPLOAD_HOSTS) {
    const form = new FormData();
    // Copy into a plain Uint8Array — Buffer's backing store isn't a BlobPart.
    form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "spike.png");
    form.append("uploadPath", "spike");
    form.append("fileName", `spike-${Date.now()}.png`); // unique: same name silently overwrites
    try {
      const res = await fetch(`${host}/api/file-stream-upload`, { method: "POST", headers: auth, body: form });
      const body = await res.json().catch(async () => ({ nonJson: await res.text() }));
      attempts[host] = { status: res.status, body };
      const url = (body as any)?.data?.downloadUrl;
      if (res.ok && typeof url === "string") {
        save("upload", attempts);
        return { host, url, raw: body };
      }
    } catch (e) {
      attempts[host] = { threw: String(e) };
    }
  }
  save("upload-failed", attempts);
  die("no upload host worked — both documented hosts were tried", attempts);
}

async function createTask(model: string, input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${API}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  });
  const body = await res.json().catch(async () => ({ nonJson: await res.text() }));
  save(`createTask-${model.replace(/\W+/g, "-")}`, { status: res.status, body });
  // The docs put a `code` inside a 200 body, so HTTP status alone is not the answer.
  const taskId = (body as any)?.data?.taskId;
  if (!taskId) die(`createTask rejected ${model}`, body);
  return taskId as string;
}

interface Record_ {
  state: string;
  creditsConsumed?: number;
  resultJson?: string;
  failCode?: string | null;
  failMsg?: string | null;
  costTime?: number;
}

async function poll(model: string, taskId: string): Promise<{ rec: Record_; states: string[]; waitedMs: number }> {
  const states: string[] = [];
  const t0 = Date.now();
  // KIE's own advice: 2-3s, backing off, give up by 10-15 minutes.
  for (let delay = 2000; Date.now() - t0 < 10 * 60_000; delay = Math.min(delay * 1.3, 15_000)) {
    await sleep(delay);
    const res = await fetch(`${API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: auth });
    const body = await res.json().catch(async () => ({ nonJson: await res.text() }));
    const rec = (body as any)?.data as Record_ | undefined;
    if (!rec) die("recordInfo returned no data", body);
    if (rec.state !== states[states.length - 1]) {
      states.push(rec.state);
      process.stdout.write(`  ${rec.state}…\n`);
    }
    if (rec.state === "success" || rec.state === "fail") {
      save(`recordInfo-${model.replace(/\W+/g, "-")}`, body);
      return { rec, states, waitedMs: Date.now() - t0 };
    }
  }
  die("still not finished after 10 minutes", { taskId, states });
}

// ---------------------------------------------------------------- the run

interface Result {
  label: string;
  model: string;
  expected: number;
  balanceDelta: number;
  creditsConsumed: number | "ABSENT";
  states: string[];
  seconds: number;
  resultShape: string;
  resultUrl?: string;
}

async function runJob(label: string, model: string, input: Record<string, unknown>, expected: number): Promise<Result> {
  console.log(`\n▸ ${label} — ${model}  (expecting ~${expected} credits)`);
  const before = await balance();
  const taskId = await createTask(model, input);
  console.log(`  taskId ${taskId}`);
  const { rec, states, waitedMs } = await poll(model, taskId);
  if (rec.state === "fail") die(`${label} failed`, { failCode: rec.failCode, failMsg: rec.failMsg });

  // Balance is read after, independently of what the record claims, so the two
  // can be compared rather than one being trusted.
  await sleep(2500);
  const after = await balance();

  let parsed: any = null;
  try { parsed = rec.resultJson ? JSON.parse(rec.resultJson) : null; } catch { /* keep raw */ }

  return {
    label,
    model,
    expected,
    balanceDelta: before - after,
    creditsConsumed: typeof rec.creditsConsumed === "number" ? rec.creditsConsumed : "ABSENT",
    states,
    seconds: Math.round(waitedMs / 1000),
    resultShape: parsed ? Object.keys(parsed).join(", ") : String(rec.resultJson).slice(0, 60),
    resultUrl: parsed?.resultUrls?.[0],
  };
}

async function main() {
  console.log("KIE reality check\n" + "=".repeat(50));

  const start = await balance();
  console.log(`balance: ${start} credits`);
  if (start < 15) die("not enough credit for the run", `${start} left; this needs about 12`);

  console.log("\n▸ upload — trying both documented hosts");
  const { host, url } = await upload(makePng());
  console.log(`  ✓ ${host}`);
  console.log(`  → ${url}`);

  const results: Result[] = [];

  // Cheapest first: if anything is wrong about auth or the task API, it costs
  // half a credit to find out rather than ten.
  results.push(await runJob("recraft crisp upscale", "recraft/crisp-upscale", { image: url }, 0.5));
  results.push(await runJob("z-image text-to-image", "z-image", { prompt: "a small red boat on calm water, soft morning light" }, 0.8));
  // The catalogue infers 2x → the rate table's "2K" row at 10 credits. This is
  // the only test here that checks an inference rather than a fact.
  results.push(await runJob("topaz upscale 2x", "topaz/image-upscale", { image_url: url, upscale_factor: "2" }, 10));

  const end = await balance();
  save("summary", { uploadHost: host, uploadUrl: url, startBalance: start, endBalance: end, results });

  console.log("\n" + "=".repeat(50));
  console.log(`upload host that works : ${host}`);
  console.log(`spent                  : ${start - end} credits (${start} → ${end})\n`);

  for (const r of results) {
    const drift = r.creditsConsumed === "ABSENT" ? "—" : (r.creditsConsumed - r.balanceDelta).toFixed(2);
    console.log(`${r.label}`);
    console.log(`  expected ${r.expected} | balance dropped ${r.balanceDelta} | creditsConsumed ${r.creditsConsumed} | drift ${drift}`);
    console.log(`  states: ${r.states.join(" → ")}   took ${r.seconds}s`);
    console.log(`  resultJson keys: ${r.resultShape}`);
    if (r.resultUrl) console.log(`  ${r.resultUrl}`);
    console.log();
  }

  const topaz = results.find((r) => r.model.includes("topaz"));
  if (topaz) {
    const ok = Math.abs(topaz.balanceDelta - 10) < 0.51;
    console.log(ok
      ? "✓ Topaz 2x cost ~10 — the factor→tier inference in pricing.ts holds."
      : `✗ Topaz 2x cost ${topaz.balanceDelta}, not 10 — the factor→tier mapping in pricing.ts is WRONG.`);
  }
  if (results.some((r) => r.creditsConsumed === "ABSENT")) {
    console.log("✗ creditsConsumed missing on at least one job — settlement cannot rely on it.");
  } else {
    console.log("✓ creditsConsumed present on every job.");
  }

  console.log(`\nRaw responses in ${OUT}`);
  console.log("Keep a result URL and re-open it tomorrow — that settles the expiry window.");
}

void main();
