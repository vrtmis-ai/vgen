/**
 * Turn KIE's documentation into machine-readable JSON Schemas, then hold the
 * catalogue against them.
 *
 *   pnpm kie:schemas           # the models we actually route to
 *   pnpm kie:schemas --all     # every model KIE documents
 *   pnpm kie:schemas --check   # crawl nothing, audit what is already saved
 *
 * Why this exists. Every parameter in `src/data/models.ts` was read off a
 * documentation page by a human and typed in again. That is a transcription
 * step, and transcription drifts: an enum gains a value, a field becomes
 * required, a model moves to a different endpoint. KIE does not fail loudly on
 * any of it — a parameter it does not recognise, or a required one that is
 * missing, comes back as a generic 500 *after* the customer's coins are held.
 *
 * So the docs are the source and this reads them the same way twice.
 *
 * The crawl is cheap and needs no key: `docs.kie.ai/llms.txt` is an index of
 * every documented model, each page is markdown with the OpenAPI spec in a
 * fenced yaml block, and that spec already carries descriptions, enums,
 * defaults, required lists and constraints. Extraction is mostly deletion —
 * Apidog's `x-apidog-*` vendor keys come out, everything else is already JSON
 * Schema.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { parse as parseYaml } from "yaml";
import { FAMILIES } from "../src/data/models";
import upstream from "../src/data/upstream.json" with { type: "json" };
import { kieRequestBody } from "../packages/adapters/src/providers/kie";
import { upstreamModel } from "./upstream";

const INDEX_URL = "https://docs.kie.ai/llms.txt";
const OUT_DIR = fileURLToPath(new URL("./kie-schemas/", import.meta.url));

/** The endpoints the KIE adapter posts to. See `packages/adapters/src/providers/kie.ts`. */
const ADAPTER_ENDPOINTS = new Set(["/api/v1/jobs/createTask", "/api/v1/veo/generate"]);

/**
 * Pages the index no longer lists but whose endpoint is still live and still
 * the only way to reach something we sell. Veo's three tiers are one of them:
 * the marketplace `veo-3-1` has no field that picks a tier.
 */
const UNLISTED_PAGES: DocPage[] = [
  { title: "Generate Veo3.1 Video (legacy endpoint)", url: "https://docs.kie.ai/old-model/veo3-api/generate-veo-3-video.md" },
];

/**
 * Documented as required, known not to be, with the reason. Printed on every
 * run rather than hidden, so a claim nobody has verified stays visible.
 *
 * KIE's required lists are generated, and not always true: the Veo 3.1 page
 * marks `watermark` and a deprecated `enable_fallback` as required.
 */
const ACCEPTED: Record<string, string> = {
  "kling-3:multi_prompt":
    "its own description says it takes effect only when multi_shots is true, and the adapter always sends multi_shots false. Unverified against the live API: a Kling 3 job costs too much to spend on the question.",
};

/** Apidog's editor metadata. Real schema keywords never start with `x-`. */
const isVendorKey = (key: string) => key.startsWith("x-");

interface DocPage {
  title: string;
  url: string;
}

interface ModelSchema {
  /**
   * Every `model` string this page documents — the key everything else joins on.
   *
   * A list, not one string: `market/kling/text-to-video` documents kling 2.6,
   * 2.5 and 2.1 as an enum on one page against one input schema. Reading only
   * the example would have found the first and declared the rest retired.
   */
  models: string[];
  title: string;
  docUrl: string;
  /** Recorded because it is not always the unified one: the veo pages still document a legacy path. */
  endpoint: string | null;
  fetchedAt: string;
  /** Draft 2020-12, describing the `input` object alone — what our controls fill in. */
  input: Record<string, unknown>;
  /** Request bodies the docs show, kept whole: the cheapest way to see a shape in practice. */
  examples: unknown[];
}

/* ---------------------------------------------------------------- 1. find */

/**
 * Every documented model page, from the index KIE publishes for exactly this.
 *
 * Guessing URLs from model ids does not work — `gpt-image-2` lives under
 * `/market/gpt/` while `gpt-image/1.5` lives under `/market/gpt-image/` — and
 * the index is authoritative about which pages exist at all.
 *
 * `/cn/` pages are the same specs in Chinese. Skipped rather than merged: they
 * would double every entry and the enums are identical.
 */
async function findModelPages(): Promise<DocPage[]> {
  const text = await fetchText(INDEX_URL);
  const pages = new Map<string, DocPage>(UNLISTED_PAGES.map((page) => [page.url, page]));
  for (const line of text.split("\n")) {
    const match = /^-\s+.*?\[([^\]]+)\]\((https:\/\/docs\.kie\.ai\/[^)]+\.md)\)/.exec(line);
    if (!match) continue;
    const [, title, url] = match as unknown as [string, string, string];
    if (url.includes("/cn/")) continue;
    pages.set(url, { title, url });
  }
  return [...pages.values()];
}

/* ------------------------------------------------------------ 2. download */

/**
 * Retried, because a single dropped request silently becomes a false accusation.
 *
 * The first run of this reported three models as "not in any documented page"
 * purely because two fetches failed in transit — and "the provider retired
 * this model" is exactly the kind of finding nobody double-checks before
 * acting on it. Three attempts with a growing pause.
 */
async function fetchText(url: string, attempts = 3): Promise<string> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "deev-schema-crawler", accept: "text/plain,text/markdown,*/*" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return await response.text();
    } catch (error) {
      last = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
  throw last instanceof Error ? last : new Error(`${url} is unreachable`);
}

/* ------------------------------ 3-8. extract schema, examples, constraints */

/**
 * Strip Apidog's vendor keys, and nothing else.
 *
 * Everything OpenAPI 3.0 leaves behind — `type`, `description`, `enum`,
 * `default`, `required`, `minLength`/`maxLength`, `minItems`/`maxItems`,
 * `minimum`/`maximum`, `format`, `pattern`, `items`, `properties` — is already
 * valid JSON Schema, so steps 5 through 8 are this one function and no
 * per-keyword handling that could silently drop a constraint it did not know
 * about. `examples` is kept: it is the only place some pages state a unit.
 */
function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (isVendorKey(key)) continue;
    // Trimmed because the pages have typos in their own keys — Seedance 2 Fast
    // documents "reference_video_urls " with a trailing space — and the API
    // does not accept the space any more than we send it.
    out[key.trim()] = clean(value);
  }
  return out;
}

/** The fenced OpenAPI block. The rest of the page is prose and card markup. */
function openApiOf(markdown: string): Record<string, unknown> | null {
  const block = /```ya?ml\n([\s\S]*?)\n```/.exec(markdown);
  if (!block) return null;
  try {
    return parseYaml(block[1]!) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * The model strings a page covers, from wherever it happens to state them.
 *
 * Four places, because the pages are not consistent: an enum when one schema
 * serves several models, otherwise a default, an example on the property, or
 * the example request body. Collected rather than first-wins, so a page that
 * lists nine models under one schema registers all nine.
 */
function modelsOf(properties: Record<string, unknown>, example: Record<string, unknown>): string[] {
  const spec = asRecord(properties.model);
  const found = [
    ...((spec.enum as unknown[] | undefined) ?? []),
    spec.default,
    ...((spec.examples as unknown[] | undefined) ?? []),
    example.model,
  ];
  return [...new Set(found.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function parseLoosely(text: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    const model = /"model"\s*:\s*"([^"]+)"/.exec(text)?.[1];
    return model ? { model } : {};
  }
}

function extract(page: DocPage, markdown: string): ModelSchema | null {
  const spec = openApiOf(markdown);
  if (!spec) return null;

  const paths = asRecord(spec.paths);
  const [endpoint, pathItem] = Object.entries(paths)[0] ?? [];
  if (!endpoint) return null;
  const operation = asRecord(asRecord(pathItem).post);
  const json = asRecord(asRecord(asRecord(operation.requestBody).content)["application/json"]);
  const body = asRecord(json.schema);
  const properties = asRecord(body.properties);

  // Some pages give the example as a string, and not always a parseable one:
  // Kling 2.5 Turbo image-to-video's reads `"input": {image`. The model id is
  // still the one thing in it worth having, so it is read out with a pattern.
  const rawExample = json.example;
  const example = typeof rawExample === "string" ? parseLoosely(rawExample) : asRecord(rawExample);
  // The legacy endpoints take the settings flat in the body, beside `model`,
  // rather than nested under `input`.
  const flat = Object.fromEntries(Object.entries(properties).filter(([key]) => key !== "model" && key !== "callBackUrl"));
  const input = properties.input ? asRecord(properties.input) : { type: "object", properties: flat, required: body.required ?? [] };
  return {
    models: modelsOf(properties, example),
    title: page.title,
    docUrl: page.url,
    endpoint,
    fetchedAt: new Date().toISOString().slice(0, 10),
    input: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: `${page.title} — input`,
      ...(clean(input) as Record<string, unknown>),
    },
    examples: Object.keys(example).length ? [clean(example)] : [],
  };
}

/* ------------------------------------------------------------- 9-10. save */

const fileNameOf = (model: string) => `${model.replace(/[^a-z0-9.-]+/gi, "_")}.json`;

/**
 * Written through Prettier, like every other generated file in the repository.
 *
 * `JSON.stringify(…, 2)` puts every enum member on its own line and Prettier
 * collapses short arrays, so the raw output fails `pnpm format:check` on all
 * fifty files at once. Formatting here rather than exempting the directory is
 * what makes a re-crawl a no-op diff when nothing upstream has moved — which is
 * the entire signal this corpus exists to give.
 */
const prettierConfig = await resolveConfig(fileURLToPath(new URL("./crawl-kie-schemas.ts", import.meta.url)));
async function writeJson(path: string, value: unknown): Promise<void> {
  writeFileSync(path, await format(JSON.stringify(value, null, 2), { ...prettierConfig, parser: "json" }), "utf8");
}

/**
 * One file per model, even when several share a page.
 *
 * The join key everywhere else is the model string, so a reader looking for
 * `kling-2.6/text-to-video` should find `kling-2.6_text-to-video.json` rather
 * than having to know it was documented alongside two other versions.
 */
async function save(schema: ModelSchema): Promise<string[]> {
  mkdirSync(OUT_DIR, { recursive: true });
  const fallback = schema.docUrl.split("/").pop()!.replace(/\.md$/, "");
  const names = (schema.models.length ? schema.models : [fallback]).map(fileNameOf);
  for (const name of names) await writeJson(`${OUT_DIR}${name}`, schema);
  return names;
}

function loadSaved(): ModelSchema[] {
  let names: string[];
  try {
    names = readdirSync(OUT_DIR).filter((name) => name.endsWith(".json") && name !== "index.json");
  } catch {
    return [];
  }
  return names.map((name) => JSON.parse(readFileSync(`${OUT_DIR}${name}`, "utf8")) as ModelSchema);
}

/* ------------------------------------------------------- the point of it all */

/**
 * What the catalogue claims, against what the provider documents.
 *
 * Four questions, each of which has already cost a real failure somewhere:
 * does the model still answer on the endpoint we post to, is every control key
 * a parameter it knows, is every option value inside its enum, and is every
 * required field something we actually send.
 */
const accepted: string[] = [];

function audit(schemas: ModelSchema[]): string[] {
  const byModel = new Map(schemas.flatMap((schema) => schema.models.map((model) => [model, schema] as const)));
  const problems: string[] = [];

  for (const family of FAMILIES) {
    for (const variant of family.variants) {
      let model: string;
      try {
        model = upstreamModel(variant.id);
      } catch {
        problems.push(`${variant.id}: no entry in upstream.json`);
        continue;
      }
      const schema = byModel.get(model);
      if (!schema) {
        problems.push(`${variant.id}: "${model}" is not in any documented page — retired, renamed, or never existed`);
        continue;
      }
      if (!schema.endpoint || !ADAPTER_ENDPOINTS.has(schema.endpoint)) {
        problems.push(`${variant.id}: "${model}" is documented on ${schema.endpoint}, which the adapter does not post to`);
      }

      const props = asRecord(asRecord(schema.input).properties);
      const required = new Set((asRecord(schema.input).required as string[] | undefined) ?? []);
      const controls = variant.controls ?? family.controls ?? [];
      // `null` on a variant means "no slots", not "inherit" — the worker reads it
      // the same way.
      const refs = (variant.refs === undefined ? family.refs : variant.refs) ?? [];
      /** A setting as it leaves the adapter: renamed, retyped, flattened. */
      const sentAs = (params: Record<string, string | number | boolean>) => {
        const body = kieRequestBody(model, params);
        return asRecord(body.input ?? body);
      };

      for (const control of controls) {
        const spec = props[control.key];
        if (!spec) {
          problems.push(`${variant.id}: control "${control.key}" is not a parameter of ${model}`);
          continue;
        }
        const enumValues = asRecord(spec).enum as unknown[] | undefined;
        if (!enumValues || !("options" in control)) continue;
        for (const option of control.options) {
          if (!enumValues.includes(sentAs({ [control.key]: option.value })[control.key])) {
            problems.push(`${variant.id}: ${control.key}="${option.value}" is not in ${model}'s enum`);
          }
        }
      }

      // A file lands under its slot key, or under `sends.key` when two slots
      // share one positional array. The worker posts every job to `model`, so
      // that is the schema a reference has to fit — a slot that only exists on
      // a sibling image-to-video endpoint reaches a model that ignores it.
      const refKeys = refs.map((ref) => ref.sends?.key ?? ref.key);
      for (const key of new Set(refKeys)) {
        if (!props[key]) problems.push(`${variant.id}: reference slot "${key}" is not a parameter of ${model}`);
      }

      // `prompt` is sent by every submission and is not a control; refs cover
      // the file inputs. Passed through the adapter's own renames, so this
      // checks what actually goes out rather than what the catalogue calls it.
      const sent = new Set(
        Object.keys(sentAs(Object.fromEntries([...controls.map((c) => c.key), ...refKeys, "prompt"].map((key) => [key, ""])))),
      );
      for (const field of required) {
        if (sent.has(field)) continue;
        const reason = ACCEPTED[`${variant.id}:${field}`];
        if (reason) accepted.push(`${variant.id}: ${model} marks "${field}" required — ${reason}`);
        else problems.push(`${variant.id}: ${model} requires "${field}", which nothing sends`);
      }
    }
  }
  return problems;
}

/* ---------------------------------------------------------------- the run */

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const all = argv.includes("--all");

if (checkOnly) {
  const saved = loadSaved();
  if (saved.length === 0) throw new Error("no saved schemas — run pnpm kie:schemas first");
  report(saved, `${saved.length} saved schemas`);
} else {
  // Every endpoint upstream.json names, not only the ones a variant reaches
  // today: an endpoint is added there first and wired to a variant after, and
  // its schema is what the variant's controls are written from.
  const wanted = new Set<string>(
    all
      ? []
      : Object.entries(upstream)
          .filter(([key]) => !key.startsWith("$"))
          .map(([, entry]) => (entry as { model: string }).model),
  );

  // Cleared, so a model we stopped routing to does not linger as a schema the
  // audit still trusts.
  rmSync(OUT_DIR, { recursive: true, force: true });

  const pages = await findModelPages();
  console.log(`index lists ${pages.length} documented pages`);

  const schemas: ModelSchema[] = [];
  let skipped = 0;
  for (const page of pages) {
    let markdown: string;
    try {
      markdown = await fetchText(page.url);
    } catch (error) {
      console.warn(`  ! ${page.url}: ${error instanceof Error ? error.message : "unreachable"}`);
      continue;
    }
    const schema = extract(page, markdown);
    if (!schema) continue;
    // Filtering after the parse rather than before it: the page URL does not
    // contain the model string, so there is nothing to match on until the
    // example has been read.
    if (!all && !schema.models.some((model) => wanted.has(model))) {
      skipped += 1;
      continue;
    }
    await save(schema);
    schemas.push(schema);
    const params = Object.keys(asRecord(asRecord(schema.input).properties)).length;
    console.log(`  ${(schema.models.join(", ") || "?").padEnd(46)} ${params} params`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  await writeJson(`${OUT_DIR}index.json`, {
    fetchedAt: new Date().toISOString().slice(0, 10),
    source: INDEX_URL,
    models: schemas
      .flatMap((schema) => schema.models.map((model) => ({ model, title: schema.title, endpoint: schema.endpoint, docUrl: schema.docUrl })))
      .sort((a, b) => a.model.localeCompare(b.model)),
  });

  console.log(`\nsaved ${schemas.length} schemas to scripts/kie-schemas/${all ? "" : `, skipped ${skipped} we do not route to`}`);
  report(schemas, `${schemas.length} crawled schemas`);
}

function report(schemas: ModelSchema[], what: string): void {
  const problems = audit(schemas);
  for (const line of accepted) console.log(`\naccepted: ${line}`);
  if (problems.length === 0) {
    console.log(`\nthe catalogue agrees with ${what} — every parameter, enum value and required field ✅`);
    process.exit(0);
  }
  console.error(`\n${problems.length} disagreements between the catalogue and ${what}:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exitCode = 1;
}
