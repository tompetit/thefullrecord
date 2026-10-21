#!/usr/bin/env node
/**
 * Check every cited source URL (voter-guide races, key votes, said-vs-did) and
 * write content/guide/link-health.json. For dead links only, look up the
 * closest Wayback Machine snapshot (read-only availability API; never saves).
 *
 * Run: npm run guide:check-links
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, errorCodeOf } from './link-classify.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'content/guide/link-health.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT = 15_000;
const PER_HOST = 4;
const OVERALL = 24;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function collect() {
  const urls = new Set();
  const add = (u) => { if (typeof u === 'string' && /^https?:\/\//i.test(u)) urls.add(u); };
  const races = join(ROOT, 'content/guide/races');
  for (const f of readdirSync(races).filter((f) => f.endsWith('.json')))
    for (const s of readJson(join(races, f)).sources ?? []) add(s.url);
  const svd = join(ROOT, 'content/said-vs-did');
  for (const f of readdirSync(svd).filter((f) => f.endsWith('.json') && !f.startsWith('_'))) {
    const d = readJson(join(svd, f));
    add(d.said?.sourceUrl);
    add(d.did?.sourceUrl);
  }
  try {
    for (const v of readJson(join(ROOT, 'content/guide/key-votes.json')).votes ?? []) {
      add(v.sourceUrl);
      add(v.summarySourceUrl);
    }
  } catch { /* optional */ }
  return [...urls].sort();
}

async function attempt(url, method) {
  const res = await fetch(url, { method, redirect: 'follow', headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(TIMEOUT) });
  try { await res.body?.cancel(); } catch { /* ignore */ }
  return { httpStatus: res.status, finalUrl: res.url };
}

async function probe(url) {
  let last;
  for (let round = 0; round < 2; round++) {
    if (round) await sleep(1500 + Math.random() * 1000);
    let out;
    try {
      out = await attempt(url, 'HEAD');
      if ([405, 403, 501].includes(out.httpStatus)) out = await attempt(url, 'GET');
    } catch (err) {
      out = { errorCode: errorCodeOf(err) };
    }
    last = out;
    const retry = out.errorCode
      ? !['ENOTFOUND', 'ECONNREFUSED'].includes(out.errorCode)
      : out.httpStatus === 429 || out.httpStatus >= 500;
    if (!retry) break;
  }
  const r = { status: classify(last) };
  if (last.httpStatus) r.httpStatus = last.httpStatus;
  if (last.errorCode) r.errorCode = last.errorCode;
  if (last.finalUrl && last.finalUrl !== url) r.finalUrl = last.finalUrl;
  return r;
}

/** Run tasks with an overall cap and a per-host cap. */
async function pool(items, worker) {
  const queue = [...items];
  const perHost = new Map();
  let active = 0;
  await new Promise((resolve) => {
    const pump = () => {
      if (!queue.length && !active) return resolve();
      for (let i = 0; i < queue.length && active < OVERALL; ) {
        const host = new URL(queue[i]).host;
        if ((perHost.get(host) ?? 0) >= PER_HOST) { i++; continue; }
        const [item] = queue.splice(i, 1);
        active++;
        perHost.set(host, (perHost.get(host) ?? 0) + 1);
        worker(item).finally(() => { active--; perHost.set(host, perHost.get(host) - 1); pump(); });
      }
    };
    pump();
  });
}

async function wayback(url) {
  try {
    const res = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const snap = (await res.json())?.archived_snapshots?.closest;
    return snap?.available && snap.url ? snap.url.replace(/^http:/, 'https:') : null;
  } catch { return null; }
}

const urls = collect();
console.log(`Checking ${urls.length} unique URLs...`);
const results = {};
let done = 0;
await pool(urls, async (u) => {
  results[u] = await probe(u);
  if (++done % 100 === 0) console.log(`  ${done}/${urls.length}`);
});

const dead = urls.filter((u) => results[u].status === 'dead');
console.log(`${dead.length} dead; looking up Wayback snapshots...`);
let next = 0;
await Promise.all([0, 1].map(async () => {
  while (next < dead.length) {
    const u = dead[next++];
    const a = await wayback(u);
    if (a) results[u].archivedUrl = a;
    await sleep(1000);
  }
}));

const sorted = Object.fromEntries(Object.keys(results).sort().map((k) => [k, results[k]]));
writeFileSync(OUT, JSON.stringify({ checkedAt: new Date().toISOString(), results: sorted }, null, 1) + '\n');
const tally = {};
for (const r of Object.values(sorted)) tally[r.status] = (tally[r.status] ?? 0) + 1;
console.log(tally, 'archived:', dead.filter((u) => sorted[u].archivedUrl).length);
