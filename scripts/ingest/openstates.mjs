/**
 * Key-gated ingest: state legislative floor votes from the Open States API v3
 * (https://docs.openstates.org/api-v3/), for every state + DC + PR except New
 * York (NY has its own official-source ingests).
 *
 * Writes src/server/snapshot/state-{st}-{chamber}.json — one file per state
 * and chamber, votes keyed by "ocd-person/{uuid}". The data is the most
 * recent bills by latest action, so it is a sample, not a full session.
 *
 * Needs OPENSTATES_API_KEY (env or .env.local). Without it this prints how to
 * get a free key and exits 0 without writing anything.
 *
 * Run: npm run ingest:openstates -- [--states tx,ca] [--pages 10] [--max-votes 300] [--resume]
 * Defaults: 10 pages (200 bills) per state, the 300 most recent vote events
 * kept per chamber. We wait ~1 s between requests, back off exponentially on
 * HTTP 429 and keep going, and stop cleanly if the limit persists. Each state
 * is written as it completes, so an interruption keeps earlier states.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSnapshot } from "./shared.mjs";
import { transformBills } from "./openstates-transform.mjs";
import { STATE_NAMES } from "../../src/lib/usStates.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SNAPSHOT_DIR = join(ROOT, "src/server/snapshot");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SNAPSHOT_DIR, { recursive: true });
const SPACING_MS = 1000;

function loadKey() {
  if (process.env.OPENSTATES_API_KEY) return process.env.OPENSTATES_API_KEY;
  const envFile = join(ROOT, ".env.local");
  return existsSync(envFile)
    ? readFileSync(envFile, "utf8").match(/^OPENSTATES_API_KEY=(\S+)/m)?.[1]
    : undefined;
}

const KEY = loadKey();
if (!KEY) {
  console.log(`OPENSTATES_API_KEY is not set, so nothing was ingested.

Get a free key: https://open.pluralpolicy.com/accounts/signup/ -> API key,
then add  OPENSTATES_API_KEY=...  to .env.local (gitignored) or the environment.`);
  process.exit(0);
}

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const PAGES = Number(flag("--pages") ?? 10);
if (!Number.isInteger(PAGES) || PAGES < 1 || PAGES > 50) throw new Error("--pages must be 1-50");
const MAX_VOTES = Number(flag("--max-votes") ?? 300);
if (!Number.isInteger(MAX_VOTES) || MAX_VOTES < 1) throw new Error("--max-votes must be a positive integer");
let rateLimited = 0;
const NOT_JURISDICTIONS = new Set(["NY", "GU", "VI", "AS", "MP"]);
const states = (flag("--states")?.split(",").map((s) => s.trim().toLowerCase()) ??
  Object.keys(STATE_NAMES).filter((s) => !NOT_JURISDICTIONS.has(s)).map((s) => s.toLowerCase()))
  .filter((s) => s !== "ny");

// --resume: skip states that already have snapshot files (continue after a rate-limit stop).
const resumed = args.includes("--resume")
  ? states.filter((st) => !readdirSync(SNAPSHOT_DIR).some((f) => f.startsWith(`state-${st}-`)))
  : states;

let lastRequest = 0;
class RateLimited extends Error {}

async function api(st, page) {
  const wait = lastRequest + SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  const url = `https://v3.openstates.org/bills?${new URLSearchParams({ jurisdiction: st, sort: "latest_action_desc", per_page: "20", page: String(page) })}&include=votes`;
  for (let attempt = 0; attempt < 6; attempt++) {
    lastRequest = Date.now();
    const res = await fetch(url, { headers: { "X-API-KEY": KEY, "User-Agent": "thefullrecord-ingest/1.0 (civic transparency)" }, signal: AbortSignal.timeout(60_000) });
    if (res.status === 429) {
      rateLimited++;
      if (attempt === 5) throw new RateLimited(`429 for ${st} page ${page}`);
      const backoff = 10_000 * 2 ** attempt;
      console.log(`  429 rate limited; waiting ${backoff / 1000}s`);
      await sleep(backoff);
      continue;
    }
    if (!res.ok) throw new Error(`Open States ${st} page ${page} -> ${res.status}`);
    return res.json();
  }
}

let requests = 0;
let written = 0;
for (const st of resumed) {
  const bills = [];
  try {
    for (let page = 1; page <= PAGES; page++) {
      const body = await api(st, page);
      requests++;
      bills.push(...(body.results ?? []));
      if (page >= (body.pagination?.max_page ?? 1)) break;
    }
  } catch (err) {
    if (err instanceof RateLimited) {
      console.log(`Stopping: ${err.message}. Re-run later with --states for the remaining states; written files are kept.`);
      break;
    }
    console.error(`  ${st}: ${err.message}; skipping`);
    continue;
  }
  const { snapshots, skipped } = transformBills(bills, st, undefined, MAX_VOTES);
  for (const [chamber, snapshot] of snapshots) {
    try {
      await writeSnapshot(join(SNAPSHOT_DIR, `state-${st}-${chamber}.json`), snapshot);
      written++;
      console.log(`  ${st}/${chamber}: ${snapshot.rollCalls.length} roll calls (${snapshot.rollCalls.at(-1).date} to ${snapshot.rollCalls[0].date})`);
    } catch (err) {
      console.error(`  ${st}/${chamber}: not written (${err.message})`);
    }
  }
  if (!snapshots.size) console.log(`  ${st}: no usable floor votes in ${bills.length} bills`);
  if (Object.keys(skipped).length) console.log(`  ${st}: skipped ${JSON.stringify(skipped)}`);
}
console.log(`Done: ${requests} requests, ${rateLimited} HTTP 429 responses, ${written} snapshot files written.`);
