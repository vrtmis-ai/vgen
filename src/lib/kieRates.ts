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

/** Load cached rates immediately and refresh from KIE if stale. Safe to call more than once. */
export function startKieRates(): void {
  if (started) return;
  started = true;
  let stale = true;
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as { t: number; rows: KieRate[] } | null;
    if (c?.rows?.length) {
      rows = c.rows;
      stale = Date.now() - c.t > TTL_MS;
      notify();
    }
  } catch {
    // corrupt cache — refetch below
  }
  if (stale) void refresh().catch(() => undefined); // offline → built-in fallback rates
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
