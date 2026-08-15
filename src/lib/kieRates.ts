// Live KIE pricing table.
//
// KIE's public pricing endpoint (the same source kie.ai's own pricing page reads)
// needs no auth and allows CORS, so the app reads it straight from the browser:
//   POST https://api.kie.ai/client/v1/model-pricing/page  { pageNum, pageSize }
// Rows are keyed by a free-text `modelDescription` ("Kling 3.0, video, with audio-720P"),
// so pricing.ts matches rows by tokens derived from the user's chosen settings.
//
// Cached in localStorage for 6h; while offline (or before the first fetch lands)
// pricing.ts falls back to its built-in rate table.

import { useSyncExternalStore } from "react";

export interface KieRate {
  desc: string; // normalized modelDescription (lowercase, single spaces)
  credits: number;
  unit: string;
}

const ENDPOINT = "https://api.kie.ai/client/v1/model-pricing/page";
const PAGE_SIZE = 100;
const CACHE_KEY = "vgen-kie-rates-v1";
const TTL_MS = 6 * 60 * 60 * 1000;

let rows: KieRate[] = [];
let version = 0;
let started = false;
const subs = new Set<() => void>();

function notify() {
  version++;
  for (const cb of subs) cb();
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Rows we are willing to price from.
 *
 * The network path already drops anything without a description or a finite
 * price. The cache path did not — it cast whatever `JSON.parse` returned and
 * trusted it. That matters because the cache lives in localStorage, which the
 * user can edit and which survives every schema change we ever make: one row
 * with a string `credits` produces `NaN` out of `findRate`, and `NaN` passes the
 * `price != null` test the create button gates on. The result is an enabled
 * button quoting `NaN` coins. Same gate on both paths.
 */
function sane(rows: unknown): KieRate[] {
  if (!Array.isArray(rows)) return [];
  const out: KieRate[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const { desc, credits, unit } = r as Record<string, unknown>;
    if (typeof desc !== "string" || !desc.trim()) continue;
    if (typeof credits !== "number" || !Number.isFinite(credits)) continue;
    out.push({ desc: norm(desc), credits, unit: typeof unit === "string" ? unit : "" });
  }
  return out;
}

interface PageResult {
  rows: KieRate[];
  total: number;
}

async function fetchPage(pageNum: number): Promise<PageResult> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageNum, pageSize: PAGE_SIZE }),
  });
  if (!res.ok) throw new Error(`kie pricing http ${res.status}`);
  const body = (await res.json()) as {
    data?: { records?: { modelDescription?: string; creditPrice?: string | number; creditUnit?: string }[]; total?: number };
  };
  const recs = body.data?.records ?? [];
  return {
    rows: recs
      .map((r) => ({ desc: norm(String(r.modelDescription ?? "")), credits: Number(r.creditPrice), unit: String(r.creditUnit ?? "") }))
      .filter((r) => r.desc && Number.isFinite(r.credits)),
    total: Number(body.data?.total ?? 0),
  };
}

async function refresh(): Promise<void> {
  const first = await fetchPage(1);
  let all = first.rows;
  const pages = Math.ceil(Math.max(first.total, all.length) / PAGE_SIZE);
  for (let p = 2; p <= pages; p++) all = all.concat((await fetchPage(p)).rows);
  if (!all.length) return; // keep whatever we had
  rows = all;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), rows }));
  } catch {
    // storage full/blocked — in-memory table still works for this session
  }
  notify();
}

const RETRY_MS = [2_000, 8_000, 30_000]; // then give up until the next reload

/** Retry a failed first load a few times: one flaky moment otherwise left the
 *  whole session on built-in fallback rates, quoting prices that may be stale. */
function refreshWithRetry(attempt = 0): void {
  void refresh().catch(() => {
    const wait = RETRY_MS[attempt];
    if (wait == null) return;
    setTimeout(() => refreshWithRetry(attempt + 1), wait);
  });
}

/** Load cached rates immediately and refresh from KIE if stale. Safe to call more than once. */
export function startKieRates(): void {
  if (started) return;
  started = true;
  let stale = true;
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as { t?: unknown; rows?: unknown } | null;
    const cached = sane(c?.rows);
    if (cached.length) {
      rows = cached;
      // A timestamp in the future — a device clock change, or a hand-edited
      // entry — would leave the cache looking permanently fresh and pin the
      // whole session to it, which is the failure the fetch retry was added to
      // close, reached through the other door. Treat the future as "just now".
      const t = typeof c?.t === "number" && Number.isFinite(c.t) ? Math.min(c.t, Date.now()) : 0;
      stale = Date.now() - t > TTL_MS;
      notify();
    }
  } catch {
    // corrupt cache — refetch below
  }
  if (stale) refreshWithRetry();
}

/** Re-render subscribers when the live table (re)loads. Returns a change counter. */
export function useKieRates(): number {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => version,
  );
}

/**
 * Credit price of the first row whose description contains every token.
 * Prefix a token with "!" to require its absence (e.g. "!quality").
 * Returns null while the table hasn't loaded or nothing matches.
 */
export function findRate(...tokens: string[]): number | null {
  if (!rows.length) return null;
  const inc: string[] = [];
  const exc: string[] = [];
  for (const t of tokens) (t.startsWith("!") ? exc : inc).push(norm(t.replace(/^!/, "")));
  const row = rows.find((r) => inc.every((t) => r.desc.includes(t)) && !exc.some((t) => r.desc.includes(t)));
  return row ? row.credits : null;
}
