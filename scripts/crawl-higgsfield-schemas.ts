/**
 * Turn Higgsfield's catalogue into machine-readable JSON Schemas, then hold our
 * routes against them.
 *
 *   pnpm higgsfield:schemas           # the modes we route to
 *   pnpm higgsfield:schemas --all     # every mode Higgsfield serves
 *   pnpm higgsfield:schemas --check   # crawl nothing, audit what is already saved
 *
 * Why this exists. Higgsfield publishes an OpenAPI document, and it describes
 * eight paths: six models plus status and cancel. The catalogue has **eighty**
 * modes. Not one of the models we want to sell is in that spec — not Cinema
 * Studio, not Genjutsu, not Soul 2, not Marketing Studio, not Kling O1 or O3 —
 * and neither is `/bytedance/seedance-2.0/text-to-video`, which is the example
 * in Higgsfield's own integration instructions. Checked 2026-09-27.
 *
 * `docs.higgsfield.ai/docs/llms.txt` is no better on its own: it lists 18 pages
 * and omits every per-model page. `/docs/models.md`,
 * `/docs/models/cinema-studio-4/generate.md` and around forty others answer 200
 * and appear in no index. They are reachable only by following the "Related
 * topics" links at the foot of the pages that are listed, so that is what step 2
 * does — a transitive walk to closure rather than a read of the index.
 *
 * That leaves one authoritative source per thing we need:
 *
 *   - which modes exist, and what they cost — `dash.higgsfield.ai`'s public,
 *     no-auth pricing and catalogue JSON. Saved memory and this crawl agree:
 *     `page_size` above 50 answers 400.
 *   - what each mode accepts — the `input_schema` embedded in its playground
 *     page. It is already JSON Schema, because it is what renders the form, so
 *     extraction here is a brace match and an unescape and no inference. The
 *     alternative was parsing `<ParamField>` prose out of the docs, which is
 *     inference, which is guessing.
 *   - a cross-check — the docs page for a mode, when one exists, states its
 *     endpoint id and one `<ParamField>` per parameter. Counting those against
 *     the schema's properties is what would catch a stale page on either side.
 *     Cinema Studio agreed at 17 and 17 when this was written.
 *
 * Marketing Studio has no docs page at all, so for that one the playground is
 * not the fallback, it is the only source. Which is the whole argument for
 * reading both.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { setDefaultResultOrder } from "node:dns";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { format, resolveConfig } from "prettier";

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

/**
 * `dash.higgsfield.ai` publishes an AAAA record this machine cannot reach, and
 * Node tries addresses in the order the resolver returns them. So `fetch` sat
 * there until it timed out — `UND_ERR_CONNECT_TIMEOUT` — while curl to the same
 * URL answered in 300ms, which is a confusing way to spend an afternoon.
 *
 * Set here rather than asking everyone to remember `--dns-result-order=ipv4first`
 * on the command line. `docs.higgsfield.ai` and `open.higgsfield.ai` are both
 * fine either way; this costs them nothing.
 */
setDefaultResultOrder("ipv4first");

const PRICING_URL = "https://dash.higgsfield.ai/api/v2/pricing/models/?page=1&page_size=50";
const CATALOG_URL = "https://dash.higgsfield.ai/api/v2/catalog-models/?page=1&page_size=50";
const DOCS_INDEX = "https://docs.higgsfield.ai/docs/llms.txt";
const PLAYGROUND = (mode: string) => `https://open.higgsfield.ai/models/${mode}/playground`;
const OUT_DIR = fileURLToPath(new URL("./higgsfield-schemas/", import.meta.url));

/**
 * Marketing Studio's presets, and the one output of this crawl that is NOT
 * evidence — it is catalogue data the browser renders as a picker, so it lands
 * in src/data/ rather than beside the schemas.
 *
 * Ids and names only. They are public catalogue identifiers, the same kind of
 * thing a variant id is, and none of them is a secret; what must never go here
 * is a price or a supplier path, which is why the reducer below copies four
 * named fields rather than the whole record.
 */
const PRESETS_FILE = fileURLToPath(new URL("../src/data/higgsfield.presets.json", import.meta.url));
const PRESETS_URL = "https://api.higgsfield.ai/marketing-studio/image/presets";

/** Where every generation goes. One host, and the mode id is the path. */
const API_BASE = "https://api.higgsfield.ai";

/**
 * What to ask for, per kind of page — and it is not a formality.
 *
 * `open.higgsfield.ai` negotiates on `Accept`. Asking for
 * `text/plain,text/markdown,text/html,…` returned **200 with a 2.5 KB stub** that
 * carried no `input_schema`, against 295 KB for the same URL with no `Accept`
 * header at all. The first version of this crawler sent one list for every
 * request and concluded that all eight modes had no schema — while curl, which
 * sends no `Accept`, had already proved otherwise minutes earlier.
 *
 * The audit is what caught it: it refused to save eight empty schemas and exited
 * non-zero instead. That is the behaviour to preserve if either of these ever
 * needs changing again.
 */
const ACCEPT_HTML = "text/html";
const ACCEPT_TEXT = "text/plain,text/markdown,*/*";
const ACCEPT_JSON = "application/json";

/**
 * The modes DEEV intends to serve, and why each one is here.
 *
 * All eight are things KIE cannot do at all. That is the entire reason to pay
 * Higgsfield's prices: across the thirty models both sell, Higgsfield averaged
 * 57% more than KIE on 2026-09-22, so a mode with a KIE equivalent belongs on
 * KIE.
 *
 * Kling O1 and O3 each serve four modes and Marketing Studio three; only the
 * ones named here get a route. `--all` saves the schemas for the rest so that
 * adding one later is a data change and not another crawl.
 */
const WANTED = new Map<string, string>([
  ["higgsfield/cinema-studio/4.0", "Cinema Studio 4.0 — cinematic video, exclusive to Higgsfield"],
  ["higgsfield/genjutsu/motion-transfer/v1.0", "Genjutsu motion transfer — billed per second of INPUT video"],
  ["higgsfield/genjutsu/object-swap/v1.0", "Genjutsu object swap — the mode the catalogue API does not list"],
  ["higgsfield-ai/soul/v2/standard", "Soul 2 — the cheapest image in either catalogue"],
  ["higgsfield-ai/soul/standard", "Soul Standard — the earlier Soul, keeps style_strength"],
  ["marketing-studio/image", "Marketing Studio — no docs page exists; playground is the only source"],
  ["kling-video/omni/first-last-frame", "Kling O1 Omni — first and last frame"],
  ["kling-video/o3/first-last-frame", "Kling O3 — first and last frame"],
]);

/**
 * Known to be right, and known to look wrong, with the reason. Printed on every
 * run rather than hidden, so a claim nobody has re-checked stays visible.
 */
const ACCEPTED: Record<string, string> = {
  "kling-video/o3/first-last-frame:required":
    "its published schema requires nothing at all. That is not a scraping bug — the docs page agrees — but it is not true either: on 2026-09-27 `POST /estimate/kling-video/o3/first-last-frame` with a prompt alone answered 400 `'first_frame_url' is a required property`. The empty list is upstream's, the real requirement is a first frame, and our route sends one. Kept as a waiver rather than a problem because the corpus records what Higgsfield publishes; the spike is what records what Higgsfield does.",
  "higgsfield/genjutsu/motion-transfer/v1.0:no-doc-paramfields":
    "the docs page documents the mode in prose rather than one ParamField per field, so there is nothing to count against. Its schema came from the playground and the endpoint id matched.",
};

/** A mode as `dash.higgsfield.ai` describes it: what exists, and what it costs. */
interface CatalogueMode {
  mode: string;
  modelSlug: string;
  title: string;
  variantTitle: string;
  outputType: string;
  operationTypes: string[];
  availability: string;
  resolutions: string[];
  durationsSeconds: number[];
  /** `amount` is what they charge today, `original_amount` the list price it is discounted from. */
  pricing: Record<string, unknown>;
}

/** What a docs page states about a mode, when a docs page exists. */
interface DocFacts {
  docUrl: string;
  /** From `**Endpoint ID:** \`…\`` — checked against the mode id rather than trusted. */
  endpointId: string | null;
  /**
   * The `Complete JSON schema` block, which is the best source there is.
   *
   * Found late, and it changes the ranking: it is real JSON Schema like the
   * playground's, but *fuller*. Soul 2's docs describe `custom_reference_id`,
   * `custom_reference_strength` and `style_strength`; its playground schema has
   * none of the three, because the form does not offer them. Character
   * references are a feature we would simply not have known about.
   */
  input: Record<string, unknown> | null;
  /** One `<ParamField body="x">` per parameter. Kept for the record, not counted:
      nested array fields appear as `multi_prompt[].prompt`, so a count disagrees
      with the schema for a reason that is not a problem. */
  paramFields: string[];
  /** The "Usage notes" bullets, kept verbatim: they carry the limits no schema states. */
  usageNotes: string[];
}

/** One saved file. */
interface ModeSchema {
  mode: string;
  title: string;
  endpoint: string;
  outputType: string;
  fetchedAt: string;
  /** Null for a mode Higgsfield documents nowhere — Marketing Studio, today. */
  docUrl: string | null;
  usageNotes: string[];
  resolutions: string[];
  durationsSeconds: number[];
  pricing: Record<string, unknown>;
  /** Which of the two sources this schema came from. `docs` wherever one exists. */
  schemaSource: "docs" | "playground";
  /** Draft 2020-12, exactly as its source carries it. Not rewritten, not inferred. */
  input: Record<string, unknown>;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const strings = (value: unknown): string[] => asArray(value).filter((item): item is string => typeof item === "string");

const numbers = (value: unknown): number[] => asArray(value).filter((item): item is number => typeof item === "number");

/* ---------------------------------------------------------------- fetching */

/**
 * Retried, and an empty body counts as a failure.
 *
 * Both halves were paid for. The retry is the same reasoning the KIE crawler
 * gives — a dropped request silently becomes a false accusation about upstream.
 * The empty-body check is Higgsfield's own contribution: during research one
 * playground fetch in four came back **200 with zero bytes**, and the first
 * version of this recorded that as "this mode has no input_schema". A scraper
 * that turns a dropped packet into a finding is worse than no scraper.
 */
async function fetchText(url: string, accept: string, attempts = 3): Promise<string> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "deev-schema-crawler", accept },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      const text = await response.text();
      if (text.trim().length === 0) throw new Error(`${url} answered 200 with an empty body`);
      return text;
    } catch (error) {
      last = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
  throw last instanceof Error ? last : new Error(`${url} is unreachable`);
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  return asRecord(JSON.parse(await fetchText(url, ACCEPT_JSON)));
}

/* ------------------------------------------------- 1. which modes exist */

/**
 * Every mode, from the pricing endpoint, which is the only source that lists
 * all of them with their price, resolutions and durations in one answer.
 *
 * The catalogue endpoint is read too, for `availability_state` — but only as an
 * overlay, because it reports one `default_mode_id` per model and so knows
 * nothing about the other 51 modes. Reading it as the mode list is how you
 * conclude Genjutsu has one mode when it has two.
 */
async function catalogue(): Promise<CatalogueMode[]> {
  const pricing = await fetchJson(PRICING_URL);
  const availability = new Map<string, string>();
  try {
    for (const row of asArray((await fetchJson(CATALOG_URL)).results)) {
      const model = asRecord(row);
      if (typeof model.slug === "string" && typeof model.availability_state === "string") {
        availability.set(model.slug, model.availability_state);
      }
    }
  } catch (error) {
    console.warn(`  ! catalogue availability unavailable: ${error instanceof Error ? error.message : "unreachable"}`);
  }

  const modes: CatalogueMode[] = [];
  for (const row of asArray(pricing.results)) {
    const model = asRecord(row);
    const modelSlug = typeof model.model_slug === "string" ? model.model_slug : "";
    for (const entry of asArray(model.modes)) {
      const mode = asRecord(entry);
      if (typeof mode.slug !== "string") continue;
      modes.push({
        mode: mode.slug,
        modelSlug,
        title: typeof mode.title === "string" ? mode.title : modelSlug,
        variantTitle: typeof mode.variant_title === "string" ? mode.variant_title : "",
        outputType: typeof mode.output_type === "string" ? mode.output_type : "",
        operationTypes: strings(mode.operation_types),
        availability:
          (typeof mode.availability_state === "string" ? mode.availability_state : "") || availability.get(modelSlug) || "unknown",
        resolutions: strings(mode.resolutions),
        durationsSeconds: numbers(mode.durations_seconds),
        pricing: asRecord(mode.pricing),
      });
    }
  }
  return modes.sort((a, b) => a.mode.localeCompare(b.mode));
}

/* --------------------------------------------- 2. what the docs say, if any */

/**
 * Every documentation page, found by walking outward from the index.
 *
 * The index is the seed and not the answer: it lists 18 pages and every
 * per-model page is missing from it. Each page footer links to others, so this
 * follows those until nothing new appears. Pages reached only that way are
 * counted and reported, because that count is the measure of how far the
 * published index can be trusted.
 */
async function docPages(): Promise<Map<string, DocFacts>> {
  const seen = new Set<string>();
  const queue: string[] = [];
  const listed = new Set<string>();

  for (const match of (await fetchText(DOCS_INDEX, ACCEPT_TEXT)).matchAll(/https:\/\/docs\.higgsfield\.ai\/docs\/[A-Za-z0-9/_.-]+\.md/g)) {
    listed.add(match[0]);
    queue.push(match[0]);
  }

  const facts = new Map<string, DocFacts>();
  let unlisted = 0;
  // A ceiling, so a link loop or a docs site that grows a generated index
  // cannot turn a crawl into an afternoon.
  while (queue.length > 0 && seen.size < 400) {
    const url = queue.shift();
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    if (!listed.has(url)) unlisted += 1;

    let markdown: string;
    try {
      markdown = await fetchText(url, ACCEPT_TEXT);
    } catch (error) {
      console.warn(`  ! ${url}: ${error instanceof Error ? error.message : "unreachable"}`);
      continue;
    }

    for (const match of markdown.matchAll(/\((\/docs\/[A-Za-z0-9/_.-]+\.md)\)/g)) {
      const next = `https://docs.higgsfield.ai${match[1] ?? ""}`;
      if (!seen.has(next)) queue.push(next);
    }

    const endpointId = /\*\*Endpoint ID:\*\*\s*`([^`]+)`/.exec(markdown)?.[1] ?? null;
    if (endpointId === null) continue;
    facts.set(endpointId, {
      docUrl: url,
      endpointId,
      input: extractDocsSchema(markdown),
      paramFields: [...markdown.matchAll(/<ParamField\s+body="([^"]+)"/g)].map((match) => match[1] ?? ""),
      usageNotes: usageNotesOf(markdown),
    });
  }

  console.log(`docs: ${seen.size} pages reached, ${unlisted} of them absent from llms.txt, ${facts.size} carry an endpoint id`);
  return facts;
}

/**
 * The "Usage notes" bullets, kept whole.
 *
 * They are the only statement of the limits no schema carries: that Genjutsu
 * trims a source video past 30 seconds and needs 409,600 pixels a frame, that
 * Cinema Studio takes at most 50 reference items across its three arrays, and
 * that the legacy misspelled `higgsfiled/...` endpoint is still callable. A
 * reader deciding what to send needs those next to the properties.
 */
function usageNotesOf(markdown: string): string[] {
  const start = markdown.indexOf("## Usage notes");
  if (start < 0) return [];
  const rest = markdown.slice(start + "## Usage notes".length);
  const end = rest.indexOf("\n## ");
  return (end < 0 ? rest : rest.slice(0, end))
    .split("\n")
    .filter((line) => line.trimStart().startsWith("* "))
    .map((line) => line.trimStart().slice(2).trim())
    .filter((line) => line.length > 0);
}

/**
 * The docs page's own JSON Schema, out of the fenced block it is published in.
 *
 * Sliced between the fences rather than parsed as MDX, and handed straight to
 * `JSON.parse`, which is the check: a bad slice throws here instead of being
 * saved as something schema-shaped. Nothing in this function decides what a
 * field means.
 */
function extractDocsSchema(markdown: string): Record<string, unknown> | null {
  const marker = markdown.indexOf('<Accordion title="Complete JSON schema">');
  if (marker < 0) return null;
  const open = markdown.indexOf("```json", marker);
  if (open < 0) return null;
  const bodyStart = markdown.indexOf("\n", open);
  const close = markdown.indexOf("```", bodyStart);
  if (bodyStart < 0 || close < 0) return null;
  try {
    return asRecord(JSON.parse(markdown.slice(bodyStart, close)));
  } catch {
    return null;
  }
}

/* ------------------------------------------- 3. what each mode accepts */

/**
 * Undo one level of JavaScript string escaping.
 *
 * The playground's payload is a JS string literal inside the HTML, so its JSON
 * arrives with every quote escaped. The backslash pass goes first through a NUL
 * placeholder, or `\\"` would be read as an escaped quote rather than a literal
 * backslash followed by a quote — which is how `"pattern": "\\S"` on the prompt
 * field breaks the parse.
 */
function unescapeFlight(text: string): string {
  // split/join rather than replace: a NUL inside a regular expression trips
  // eslint's `no-control-regex`, and nothing here needs a pattern at all.
  return text.split("\\\\").join("\u0000").split('\\"').join('"').split("\u0000").join("\\");
}

/**
 * The mode's JSON Schema, lifted out of the page that renders its form.
 *
 * Brace-matched rather than regexed, because the schema nests four deep. The
 * `JSON.parse` at the end is the check: a mismatched slice throws here instead
 * of saving something that merely looks like a schema. Nothing in this function
 * decides what a parameter means — that is the point of it.
 */
function extractInputSchema(html: string): Record<string, unknown> | null {
  const key = '\\"input_schema\\":';
  const at = html.indexOf(key);
  if (at < 0) return null;
  const start = html.indexOf("{", at + key.length);
  if (start < 0) return null;

  let depth = 0;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return asRecord(JSON.parse(unescapeFlight(html.slice(start, index + 1))));
    }
  }
  return null;
}

/* ---------------------------------------------------------------- saving */

const fileNameOf = (mode: string) => `${mode.replace(/[^a-z0-9.-]+/gi, "_")}.json`;

/**
 * Written through Prettier, like every other generated file here.
 *
 * `JSON.stringify(…, 2)` puts every enum member on its own line and Prettier
 * collapses the short ones, so raw output fails `pnpm format:check` on every
 * file at once. Formatting here is what makes a re-crawl a zero-line diff when
 * nothing upstream has moved, which is the signal this corpus exists to give.
 */
const prettierConfig = await resolveConfig(fileURLToPath(new URL("./crawl-higgsfield-schemas.ts", import.meta.url)));

async function writeJson(path: string, value: unknown): Promise<void> {
  writeFileSync(path, await format(JSON.stringify(value, null, 2), { ...prettierConfig, parser: "json" }), "utf8");
}

function loadSaved(): ModeSchema[] {
  let names: string[];
  try {
    names = readdirSync(OUT_DIR).filter((name) => name.endsWith(".json") && name !== "index.json");
  } catch {
    return [];
  }
  return names.map((name) => JSON.parse(readFileSync(`${OUT_DIR}${name}`, "utf8")) as ModeSchema);
}

/* ------------------------------------------------------- the point of it all */

const accepted: string[] = [];

/**
 * Disagreements noticed while crawling, as opposed to while auditing.
 *
 * A source that offers a parameter its own documentation does not describe is
 * only visible with both pages in hand, so it cannot be re-checked offline by
 * `--check`. It is still a problem, so it is carried to the same report.
 */
const problemsFound: string[] = [];

/**
 * Four questions per saved mode, each one a way this corpus could be wrong.
 *
 * None of them ask whether Higgsfield is behaving. They ask whether what we
 * saved describes what we are about to POST to — which is the only question a
 * committed corpus can answer offline, and the one that matters before a
 * customer's coins are held against a request shape nobody checked.
 */
function audit(schemas: ModeSchema[], docs: Map<string, DocFacts> | null): string[] {
  const problems: string[] = [...problemsFound];
  const byMode = new Map(schemas.map((schema) => [schema.mode, schema]));

  // 1. Everything we intend to route to has a schema at all.
  for (const [mode, why] of WANTED) {
    if (!byMode.has(mode)) problems.push(`${mode}: no saved schema — ${why}`);
  }

  for (const schema of schemas) {
    const properties = asRecord(schema.input.properties);
    const names = Object.keys(properties);

    // 2. A schema with no properties is a parse that half-worked.
    if (names.length === 0) {
      problems.push(`${schema.mode}: schema has no properties`);
      continue;
    }

    // 3. Every required field is a field the schema also describes. Higgsfield
    //    generates these lists, and a required name absent from properties would
    //    be a field we could never send correctly.
    for (const field of strings(schema.input.required)) {
      if (!(field in properties)) problems.push(`${schema.mode}: requires "${field}", which is not one of its own properties`);
    }
    if (strings(schema.input.required).length === 0) {
      const reason = ACCEPTED[`${schema.mode}:required`];
      if (reason) accepted.push(`${schema.mode}: nothing is required — ${reason}`);
    }

    // 4. The docs page and the playground agree about how many parameters there
    //    are, and about the endpoint. Either one can go stale; this is the only
    //    thing that would say so.
    const facts = docs?.get(schema.mode);
    if (!facts) continue;
    if (facts.endpointId !== schema.mode) {
      problems.push(`${schema.mode}: its docs page states endpoint id "${facts.endpointId ?? "none"}"`);
    }
    // Every parameter the prose documents is one the schema describes. Compared
    // by name rather than by count, because a nested array field is written
    // `multi_prompt[].prompt` in the prose and lives inside `items` in the
    // schema — a count disagreed on Kling O3 for that reason alone.
    for (const field of facts.paramFields) {
      const [head] = field.split("[");
      if (head && head.length > 0 && !(head in properties)) {
        problems.push(`${schema.mode}: docs document "${field}", which its saved schema does not describe`);
      }
    }
  }
  return problems;
}

/**
 * Marketing Studio's preset list, which is the one thing here that needs a key.
 *
 * Skipped rather than fatal without one: everything else in this crawl is
 * public, and a contributor with no Higgsfield credential should still be able
 * to refresh the schemas. The committed file is then left exactly as it was,
 * which is better than half of one.
 *
 * `enhance_prompt` is deliberately not offered anywhere in the catalogue, and
 * this is where the reason lives. Checked against the live API on 2026-09-27:
 * turning it on requires a preset AND one or two images AND `quality: high`,
 * and each missing piece is its own 400 — `'preset_id' is a required property`,
 * `'image_urls' is a required property`, `quality: 'high' was expected`. Three
 * cross-field rules that a list of independent controls cannot express, and
 * every one of them would fail after the customer's coins were held. A preset
 * on its own, without enhancement, answers 200 and costs the same as no preset
 * at all, so that is what DEEV offers.
 */
async function savePresets(): Promise<void> {
  const key = process.env.HIGGSFIELD_API_KEY?.trim();
  if (!key) {
    console.log("presets: skipped, HIGGSFIELD_API_KEY is not set (the schemas above need no key)");
    return;
  }

  const items: Record<string, unknown>[] = [];
  let cursor = 0;
  for (let page = 0; page < 20; page += 1) {
    const response = await fetch(`${PRESETS_URL}?cursor=${cursor}`, {
      headers: { Authorization: `Key ${key}`, accept: ACCEPT_JSON },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.warn(`  ! presets answered ${response.status} — leaving the committed list alone`);
      return;
    }
    const body = asRecord(await response.json());
    for (const item of asArray(body.items)) items.push(asRecord(item));
    const total = typeof body.total === "number" ? body.total : items.length;
    const next = typeof body.cursor === "number" ? body.cursor : 0;
    if (items.length >= total || next === 0 || next === cursor) break;
    cursor = next;
  }

  const presets = items
    .map((item) => ({
      id: String(item.id ?? ""),
      name: String(item.name ?? ""),
      group: String(asRecord(item.metadata).group_name ?? ""),
      aspectRatio: String(asRecord(item.metadata).aspect_ratio ?? ""),
    }))
    .filter((preset) => preset.id !== "" && preset.name !== "")
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

  await writeJson(PRESETS_FILE, { fetchedAt: new Date().toISOString().slice(0, 10), source: PRESETS_URL, presets });
  console.log(`presets: ${presets.length} saved to src/data/higgsfield.presets.json`);
}

function report(schemas: ModeSchema[], docs: Map<string, DocFacts> | null, what: string): void {
  const problems = audit(schemas, docs);
  for (const line of accepted) console.log(`\naccepted: ${line}`);
  if (problems.length === 0) {
    console.log(`\n${what} describe every mode we route to, and the docs agree with them ✅`);
    return;
  }
  console.error(`\n${problems.length} problems with ${what}:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exitCode = 1;
}

/* ---------------------------------------------------------------- the run */

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const all = argv.includes("--all");

if (checkOnly) {
  const saved = loadSaved();
  if (saved.length === 0) throw new Error("no saved schemas — run pnpm higgsfield:schemas first");
  report(saved, null, `${saved.length} saved schemas`);
} else {
  const modes = await catalogue();
  console.log(`catalogue: ${new Set(modes.map((mode) => mode.modelSlug)).size} models, ${modes.length} modes`);

  const docs = await docPages();
  const wanted = modes.filter((mode) => all || WANTED.has(mode.mode));
  const missing = [...WANTED.keys()].filter((mode) => !modes.some((entry) => entry.mode === mode));
  for (const mode of missing) console.warn(`  ! ${mode} is not in the catalogue listing — its docs page is the only evidence it exists`);

  // Cleared, so a mode Higgsfield retires does not linger as a schema the audit
  // still trusts.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const schemas: ModeSchema[] = [];
  for (const mode of wanted) {
    const facts = docs.get(mode.mode);

    // Both sources, every time, even though only one is saved. The playground is
    // how a docs page that has gone stale gets noticed, and it is the only source
    // for a mode with no docs page at all — 11 of the 80 have none.
    let fromPlayground: Record<string, unknown> | null = null;
    try {
      fromPlayground = extractInputSchema(await fetchText(PLAYGROUND(mode.mode), ACCEPT_HTML));
    } catch (error) {
      console.warn(`  ! ${mode.mode}: playground unreachable — ${error instanceof Error ? error.message : "no answer"}`);
    }

    const input = facts?.input ?? fromPlayground;
    if (input === null || input === undefined) {
      console.warn(`  ! ${mode.mode}: neither its docs page nor its playground carries a schema`);
      continue;
    }
    if (facts?.input && fromPlayground) {
      const inDocs = Object.keys(asRecord(facts.input.properties));
      const inForm = Object.keys(asRecord(fromPlayground.properties));
      const docsOnly = inDocs.filter((name) => !inForm.includes(name));
      const formOnly = inForm.filter((name) => !inDocs.includes(name));
      if (formOnly.length > 0) {
        problemsFound.push(`${mode.mode}: the playground offers ${formOnly.join(", ")}, which its docs page does not describe`);
      }
      if (docsOnly.length > 0) {
        console.log(`    documented but not in the form: ${docsOnly.join(", ")}`);
      }
    }

    const schema: ModeSchema = {
      mode: mode.mode,
      title: mode.variantTitle ? `${mode.title} · ${mode.variantTitle}` : mode.title,
      endpoint: `${API_BASE}/${mode.mode}`,
      outputType: mode.outputType,
      fetchedAt: new Date().toISOString().slice(0, 10),
      docUrl: facts?.docUrl ?? null,
      usageNotes: facts?.usageNotes ?? [],
      resolutions: mode.resolutions,
      durationsSeconds: mode.durationsSeconds,
      pricing: mode.pricing,
      schemaSource: facts?.input ? "docs" : "playground",
      input,
    };
    await writeJson(`${OUT_DIR}${fileNameOf(mode.mode)}`, schema);
    schemas.push(schema);
    const count = Object.keys(asRecord(input.properties)).length;
    console.log(`  ${mode.mode.padEnd(44)} ${String(count).padStart(2)} params  from ${schema.schemaSource}`);
  }

  await writeJson(`${OUT_DIR}index.json`, {
    fetchedAt: new Date().toISOString().slice(0, 10),
    sources: [PRICING_URL, CATALOG_URL, DOCS_INDEX],
    modes: schemas
      .map((schema) => ({
        mode: schema.mode,
        title: schema.title,
        endpoint: schema.endpoint,
        outputType: schema.outputType,
        docUrl: schema.docUrl,
        schemaSource: schema.schemaSource,
        params: Object.keys(asRecord(schema.input.properties)).length,
        pricing: schema.pricing,
      }))
      .sort((a, b) => a.mode.localeCompare(b.mode)),
  });

  console.log(`\nsaved ${schemas.length} schemas to scripts/higgsfield-schemas/`);
  await savePresets();
  report(schemas, docs, `${schemas.length} crawled schemas`);
}
