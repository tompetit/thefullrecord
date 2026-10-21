/**
 * Enrichment: say what generic federal roll calls ("On Agreeing to the
 * Amendment", "On Motion to Recommit", …) were about, from OFFICIAL sources only.
 *
 * House: Clerk roll XML (<amendment-num>, <amendment-author>) + congress.gov
 *   /bill/119/<type>/<n>/amendments (matched on "Roll no. N" in latestAction,
 *   same date) + /amendment/119/hamdt/<n> (verbatim purpose, sponsor).
 * Senate: senate.gov vote XML <amendment> block (number, purpose).
 * Other generic House motions get "<Motion> — <official bill title>".
 *
 * Sets rc.amendment = { number, sponsor?, purpose?, sourceUrl } and, for generic
 * House titles, a readable rc.title. Real bill titles are never touched.
 * Incremental: rolls that already have `amendment` or a non-generic title are
 * skipped; every HTTP response is cached in ~/.cache/congress-amdt (<= 4 req/s).
 * Needs CONGRESS_GOV_API_KEY (env or .env.local). Never called by the site.
 *
 * Run: node scripts/ingest/enrich-amendments.mjs
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { decodeXml } from "./shared.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SNAP = (f) => join(ROOT, "src/server/snapshot", f);
const CACHE = join(homedir(), ".cache/congress-amdt");
mkdirSync(CACHE, { recursive: true });
const KEY =
  process.env.CONGRESS_GOV_API_KEY ??
  (existsSync(join(ROOT, ".env.local")) ? readFileSync(join(ROOT, ".env.local"), "utf8").match(/CONGRESS_GOV_API_KEY=(\S+)/)?.[1] : undefined);
if (!KEY) throw new Error("CONGRESS_GOV_API_KEY not set (env or .env.local)");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cached GET; returns text or null on 404. Network calls are spaced 260 ms apart. */
async function get(url) {
  const file = join(CACHE, createHash("sha1").update(url.replace(KEY, "")).digest("hex"));
  if (existsSync(file)) {
    const t = await readFile(file, "utf8");
    return t === "404" ? null : t;
  }
  await sleep(260);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) { await writeFile(file, "404"); return null; }
  if (!res.ok) throw new Error(`${url.replace(KEY, "***")} -> ${res.status}`);
  const text = await res.text();
  await writeFile(file, text);
  return text;
}
const api = async (path) => {
  const t = await get(`https://api.congress.gov/v3/${path}${path.includes("?") ? "&" : "?"}api_key=${KEY}&format=json`);
  return t && JSON.parse(t);
};

const tag = (xml, name) => decodeXml(xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`))?.[1] ?? "").replace(/\s+/g, " ").trim();

const BILL_TYPES = [["H.R. ", "hr"], ["H.Res. ", "hres"], ["H.Con.Res. ", "hconres"], ["H.J.Res. ", "hjres"], ["S.Con.Res. ", "sconres"], ["S.J.Res. ", "sjres"], ["S.Res. ", "sres"], ["S. ", "s"]];
function parseBill(display) {
  for (const [prefix, type] of BILL_TYPES) {
    const num = display.startsWith(prefix) ? display.slice(prefix.length).trim() : "";
    if (/^\d+$/.test(num)) return { type, num };
  }
  return null;
}

const billTitle = async (b) => (await api(`bill/119/${b.type}/${b.num}`))?.bill?.title;

/** All amendments of a bill (list items carry description, purpose, latestAction). */
const amendmentLists = new Map();
async function billAmendments(b) {
  const k = `${b.type}/${b.num}`;
  if (!amendmentLists.has(k)) {
    const out = [];
    for (let offset = 0; ; offset += 250) {
      const page = await api(`bill/119/${b.type}/${b.num}/amendments?limit=250&offset=${offset}`);
      out.push(...(page?.amendments ?? []));
      if (!page?.pagination?.next) break;
    }
    amendmentLists.set(k, out);
  }
  return amendmentLists.get(k);
}

const GENERIC = /^On (?!the Nomination)/;
const isGeneric = (rc) => (GENERIC.test(rc.title) && !rc.title.includes(" — ")) || rc.title === rc.question || /^Call (of the House|by States)/.test(rc.title);

async function enrichHouse(rc) {
  const [, year, roll] = rc.id.split("-");
  const xml = await get(`https://clerk.house.gov/evs/${year}/roll${roll.padStart(3, "0")}.xml`);
  if (!xml) return "no clerk XML";
  const b = parseBill(rc.bill);
  if (!b) return "no bill (procedural motion)";
  const full = await billTitle(b);
  if (!full) return "no bill title from API";
  const author = tag(xml, "amendment-author"); // "Grothman of Wisconsin Part A Amendment No. 316"
  if (!tag(xml, "amendment-num") && !/amendment/i.test(rc.question)) {
    rc.title = `${rc.title} — ${full}`; // motion: official bill title, no invented text
    return "motion";
  }
  const last = author.split(/ of | Part | Amendment /)[0] || "House"; // "Grothman of Wisconsin Part A Amendment No. 316"
  const partNo = author.match(/(?:(Part [A-Z])\s+)?Amendment No\.?\s*(\d+)/);
  const list = await billAmendments(b);
  let hit = list.find((a) => a.latestAction?.actionDate === rc.date && new RegExp(`\\(Roll no\\. ${Number(roll)}\\)`).test(a.latestAction.text));
  if (!hit && partNo) {
    const re = new RegExp(`^An amendment numbered ${partNo[2]} printed in ${partNo[1] ?? "Part [A-Z]"}\\b`);
    hit = list.find((a) => re.test(a.description ?? "") && a.latestAction?.actionDate === rc.date);
  }
  let amendment;
  if (hit) {
    const d = (await api(`amendment/119/hamdt/${hit.number}`))?.amendment;
    amendment = {
      number: `H.Amdt. ${hit.number}`,
      sponsor: d?.sponsors?.[0]?.fullName,
      purpose: d?.purpose ?? hit.purpose ?? d?.description ?? hit.description,
      sourceUrl: `https://www.congress.gov/amendment/119th-congress/house-amendment/${hit.number}`,
    };
    amendment.last = d?.sponsors?.[0]?.lastName;
  } else if (author) {
    // Clerk XML only: official designation and author, no purpose text.
    amendment = { number: author.replace(/^.*?(Part [A-Z] )?(Amendment No\..*)$/, "$1$2"), sponsor: last, sourceUrl: rc.sourceUrl };
  } else return "amendment not found in API or clerk XML";
  const who = amendment.last ?? last;
  delete amendment.last;
  for (const k of Object.keys(amendment)) if (amendment[k] === undefined) delete amendment[k];
  rc.amendment = amendment;
  rc.title = `Amendment (${who}) to ${rc.bill} — ${full}`;
  return hit ? "amendment" : "amendment (clerk only)";
}

async function enrichSenate(rc) {
  const [, , session, num] = rc.id.split("-");
  const n = num.padStart(5, "0");
  const xml = await get(`https://www.senate.gov/legislative/LIS/roll_call_votes/vote119${session}/vote_119_${session}_${n}.xml`);
  if (!xml) return "no senate XML";
  const block = xml.match(/<amendment>([\s\S]*?)<\/amendment>/)?.[1] ?? "";
  const number = tag(block, "amendment_number");
  if (!number) return "no amendment block";
  const purpose = tag(block, "amendment_purpose");
  const sponsor = tag(xml, "vote_title").match(/(?:^|:\s|Re:\s|Table\s|Cloture\s|Motion\s)([A-Z][\w.'-]*(?: [A-Z][\w.'-]*)?) Amdt\./)?.[1];
  const amdt = number.match(/\d+/)?.[0];
  rc.amendment = {
    number,
    ...(sponsor && { sponsor }),
    ...(purpose && { purpose }),
    sourceUrl: amdt ? `https://www.congress.gov/amendment/119th-congress/senate-amendment/${amdt}` : rc.sourceUrl,
  };
  return "amendment";
}

async function run(file, handler, wanted) {
  const path = SNAP(file);
  const snapshot = JSON.parse(await readFile(path, "utf8"));
  const tally = {};
  for (const rc of snapshot.rollCalls) {
    if (rc.amendment || !wanted(rc)) continue;
    const r = await handler(rc);
    tally[r] = (tally[r] ?? 0) + 1;
  }
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  const left = snapshot.rollCalls.filter(isGeneric).length;
  console.log(`${file}: ${JSON.stringify(tally)}; generic titles remaining: ${left}/${snapshot.rollCalls.length}`);
  for (const rc of snapshot.rollCalls.filter(isGeneric)) console.log(`  ${rc.id} ${rc.bill} | ${rc.title}`);
}

await run("house.json", enrichHouse, isGeneric);
await run("ussenate.json", enrichSenate, (rc) => /Amdt|amendment/i.test(`${rc.question} ${rc.title}`));
