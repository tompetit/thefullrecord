/**
 * One-off enrichment: add official titles and CRS summaries from the
 * congress.gov API to the federal snapshots (house.json, ussenate.json).
 * Requires CONGRESS_GOV_API_KEY in .env.local.
 *
 * Summaries added here are OFFICIAL (CRS) text, marked
 * summarySource: "official" so the UI labels them correctly.
 *
 * Run: node scripts/ingest/enrich-congress.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CONGRESS = 119;
const FILES = ["house.json", "ussenate.json"].map((f) =>
  join(ROOT, "src/server/snapshot", f)
);

const KEY =
  process.env.CONGRESS_GOV_API_KEY ??
  (existsSync(join(ROOT, ".env.local")) ? readFileSync(join(ROOT, ".env.local"), "utf8").match(/CONGRESS_GOV_API_KEY=(\S+)/)?.[1] : undefined);
if (!KEY) throw new Error("CONGRESS_GOV_API_KEY not set (env or .env.local)");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  const url = `https://api.congress.gov/v3/${path}${path.includes("?") ? "&" : "?"}api_key=${KEY}&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const BILL_TYPES = [
  ["H.R. ", "hr"],
  ["H.Res. ", "hres"],
  ["H.Con.Res. ", "hconres"],
  ["H.J.Res. ", "hjres"],
  ["S.Con.Res. ", "sconres"],
  ["S.J.Res. ", "sjres"],
  ["S.Res. ", "sres"],
  ["S. ", "s"],
];

function parseBillRef(display) {
  for (const [prefix, type] of BILL_TYPES) {
    if (display.startsWith(prefix)) {
      const num = display.slice(prefix.length).trim();
      if (/^\d+$/.test(num)) return { kind: "bill", type, num };
    }
  }
  const nom = display.match(/^PN(\d+)(?:-\d+)?$/);
  if (nom) return { kind: "nomination", num: nom[1] };
  return null;
}

const stripHtml = (s) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();

/** First sentences of the CRS summary, capped near 320 chars. */
function condense(text) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let out = "";
  for (const s of sentences) {
    if (out && out.length + s.length > 320) break;
    out += s;
    if (out.length > 180) break;
  }
  return out.trim();
}

const cache = new Map();

async function enrichRef(ref) {
  const cacheKey = ref.kind === "bill" ? `${ref.type}/${ref.num}` : `pn/${ref.num}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  let result = null;

  if (ref.kind === "bill") {
    const detail = await api(`bill/${CONGRESS}/${ref.type}/${ref.num}`);
    await sleep(120);
    const title = detail?.bill?.title;
    let summary;
    const summaries = await api(`bill/${CONGRESS}/${ref.type}/${ref.num}/summaries`);
    await sleep(120);
    const items = summaries?.summaries;
    if (items?.length) summary = condense(stripHtml(items[items.length - 1].text));
    result = { title, summary };
  } else {
    // Nominations: the vote-menu title ("Jane Doe, of New York, to be …")
    // is already the best display title — only add a summary, never
    // overwrite the title.
    const detail = await api(`nomination/${CONGRESS}/${ref.num}`);
    await sleep(120);
    const n = detail?.nomination;
    if (n) {
      const desc = n.nominees?.[0]?.introText ?? "";
      result = {
        title: undefined,
        summary: desc ? condense(stripHtml(desc)) : undefined,
      };
    }
  }
  cache.set(cacheKey, result);
  return result;
}

async function main() {
  for (const file of FILES) {
    const snapshot = JSON.parse(await readFile(file, "utf8"));
    let enriched = 0;
    for (const rc of snapshot.rollCalls) {
      const ref = parseBillRef(rc.bill);
      if (!ref) {
        console.log(`  skip (unparsed): ${rc.bill}`);
        continue;
      }
      const info = await enrichRef(ref);
      if (!info) {
        console.log(`  not found on congress.gov: ${rc.bill}`);
        continue;
      }
      // Preserve the actual roll-call description, especially amendment text.
      if (info.title && !rc.title) rc.title = info.title;
      if (info.summary) {
        rc.summary = info.summary;
        rc.summarySource = "official";
      }
      enriched++;
      console.log(`  ${rc.bill}: title${info.summary ? " + summary" : " only"}`);
    }
    await writeFile(file, JSON.stringify(snapshot, null, 2));
    console.log(`${file.split("/").pop()}: enriched ${enriched}/${snapshot.rollCalls.length}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
