/**
 * Georgia 2025-26 regular-session floor votes from the General Assembly's own web API
 * (https://www.legis.ga.gov/api, the back end of the legis.ga.gov site). Replaces the sampled Open States
 * files state-ga-{lower,upper}.json with every House and Senate recorded floor vote tied to a bill.
 *
 * The API wants a bearer token, which the site's own JS fetches anonymously on page load. We load https://www.legis.ga.gov/ in headless
 * Chromium (Playwright) and reuse the Authorization header of the site's own API requests; reloaded every ~4 min (tokens last ~5).
 * Needs Playwright: PLAYWRIGHT_MODULE (path to playwright/index.mjs, default "playwright") and CHROMIUM_PATH (executable).
 * Endpoints (JSON):
 *   GET  Vote/list/{1 House|2 Senate}/1033     every floor vote: id, number, caption, date, yea/nay/NV/excused
 *   GET  Vote/detail/{voteId}                  per-member memberVoted (0 yea, 1 nay, 2 excused, 3 not voting)
 *                                              + the bills the vote applied to (en-bloc votes list several)
 *   GET  legislation/detail/{legislationId}    title, documentType (1 bill, 2 resolution), firstReader summary
 *   GET  members/list/1033                     member id -> chamber, district, name
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/ga.csv (chamber + district,
 * family name must agree); members who left office fall back to Open States' retired list on full name.
 * Excused and Not Voting both map to "absent". Simple resolutions (HR/SR) and votes tied to no bill are omitted.
 * Bill summary is the official First Reader Summary (trimmed; omitted if it only repeats the title).
 *
 * Responses are cached in --work (default ~/.cache/ga-leg/cache); <= 3 requests/second.
 * Run: node scripts/ingest/ga-leg.mjs [--work dir]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { politeGet, writeSnapshot } from "./shared.mjs";
import { billSummary, classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const API = "https://www.legis.ga.gov/api";
const SESSION = 1033; // 2025-2026 Regular Session
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHAMBERS = { 1: "lower", 2: "upper" };
// Open States files Nabilah Islam Parkes (Senate 7) under her former name, so no name match finds her.
const ALIASES = { 5015: "ocd-person/23ffff2b-3ce6-46dc-996c-7b4fd71607bc" };
const POSITION = { 0: "yes", 1: "no", 2: "absent", 3: "absent" };

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/ga-leg/cache");
mkdirSync(work, { recursive: true });

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
let token = "";
let tokenAt = 0;
page.on("request", (r) => { const a = r.headers().authorization; if (a && r.url().startsWith(API)) token = a; });
async function authHeaders() {
  if (!token || Date.now() - tokenAt > 240_000) {
    token = "";
    await page.goto("https://www.legis.ga.gov/", { waitUntil: "networkidle" });
    if (!token) throw new Error("site did not issue an API token");
    tokenAt = Date.now();
  }
  return { Authorization: token };
}
/** Cached GET returning parsed JSON. */
const failed = new Set(); // paths the server 500s on (a few Vote/detail ids); not retried again in this run
async function get(path) {
  if (failed.has(path)) throw new Error(`${path} failed earlier`);
  const file = join(work, path.replace(/[^A-Za-z0-9]+/g, "_") + ".json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  let res;
  try {
    try { res = await politeGet(`${API}/${path}`, { minGapMs: 340, headers: await authHeaders() }); }
    catch (e) { if (!/401/.test(e.message)) throw e; tokenAt = 0; res = await politeGet(`${API}/${path}`, { minGapMs: 340, headers: await authHeaders() }); }
  } catch (e) { failed.add(path); throw e; }
  const text = await res.text();
  writeFileSync(file, text);
  return JSON.parse(text);
}
const fam = (s) => norm(String(s).replace(/\s+(II|III|IV|Jr\.?|Sr\.?)$/i, "")); // drop generational suffix
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
function csv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// --- Roster: GA member id -> Open States person.
const people = csv(await (await politeGet("https://data.openstates.org/people/current/ga.csv")).text());
const retired = []; // [normalised first+middle+family, ocd id]
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/ga/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (m) retired.push([norm(m[1]), `ocd-person/${m[2]}`]);
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const roster = new Map(); // member id -> { chamber, district, family, first }
for (const m of await get(`members/list/${SESSION}`)) {
  roster.set(m.id, { chamber: CHAMBERS[m.district?.chamberType], district: String(m.districtNumber ?? m.district?.number), family: m.name?.familyName ?? m.lastName, first: m.firstName });
}
const personCache = new Map(); // member id -> ocd-person id | null
function personFor(memberId, voteName, chamber) {
  if (personCache.has(memberId)) return personCache.get(memberId);
  const r = roster.get(memberId) ?? (() => { // "ADESANYA, 43RD" -> family + district
    const m = /^(.+),\s*(\d+)/.exec(voteName); return m ? { chamber, district: m[2], family: m[1], first: "" } : null;
  })();
  let id = ALIASES[memberId] ?? null;
  if (r && !id) {
    const seat = people.filter((x) => x.current_chamber === r.chamber && x.current_district === r.district);
    // Family name, else first name (Open States lists Sylvia Wayfer Baker as "Sylvia Wayfer").
    const p = seat.find((x) => fam(x.family_name) === fam(r.family)) ?? (r.first && seat.find((x) => norm(r.first).startsWith(norm(x.given_name))));
    // Retired files carry middle initials ("Mandi-L-Ballinger"): match first-name prefix + family-name suffix.
    id = p ? p.id : r.first ? retired.find(([k]) => k.startsWith(norm(r.first).slice(0, 4)) && k.endsWith(fam(r.family)))?.[1] ?? null : null;
  }
  personCache.set(memberId, id);
  return id;
}

const billCache = new Map();
async function bill(legislationId) {
  if (!billCache.has(legislationId)) {
    const d = await get(`legislation/detail/${legislationId}`);
    billCache.set(legislationId, { title: String(d.title ?? "").replace(/\s+/g, " ").trim(), firstReader: d.firstReader });
  }
  return billCache.get(legislationId);
}

/** Warm the cache with a few requests in flight (latency is ~2 s; the 340 ms gap in politeGet still caps us at 3/s). */
async function prefetch(paths) {
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < paths.length) { const p = paths[i++]; try { await get(p); } catch (e) { console.warn(`${p}: ${e.message}`); } }
  }));
}
const voteLists = {};
for (const num of Object.keys(CHAMBERS)) voteLists[num] = await get(`Vote/list/${num}/${SESSION}`);
await prefetch(Object.values(voteLists).flat().map((v) => `Vote/detail/${v.id}`));
const billIds = new Set();
for (const v of Object.values(voteLists).flat()) {
  try { for (const l of (await get(`Vote/detail/${v.id}`)).legislation ?? []) if (!/^[HS]R\s/.test(l.description)) billIds.add(l.legislationId); } catch {}
}
await prefetch([...billIds].map((id) => `legislation/detail/${id}`));

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const unmatched = new Map(); const skipped = {}; let tallyMismatch = 0;
const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
for (const [num, chamber] of Object.entries(CHAMBERS)) {
  const list = voteLists[num];
  let n = 0;
  for (const v of list) {
    if (++n % 200 === 0) console.log(`${chamber} ${n}/${list.length}`);
    const day = String(v.date).slice(0, 10);
    let detail;
    try { detail = await get(`Vote/detail/${v.id}`); } catch (e) { console.warn(`${chamber} vote ${v.id} (#${v.number} ${day}) ${e.message}`); skip("detail-error"); continue; }
    if (!detail.legislation?.length) { skip("no-bill"); continue; }
    const votes = {}; let yes = 0, no = 0;
    for (const mv of detail.votes ?? []) {
      const pos = POSITION[mv.memberVoted];
      if (!pos) continue;
      if (pos === "yes") yes++; else if (pos === "no") no++;
      const id = personFor(mv.member.id, mv.member.name, chamber);
      if (!id) { const k = `${chamber}:${mv.member.name}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
      votes[id] = pos;
    }
    if (!Object.keys(votes).length) { skip("no-matched-voters"); continue; }
    if (yes !== v.yea || no !== v.nay) tallyMismatch++;
    const caption = String(v.caption ?? "").replace(/\s+/g, " ").trim();
    for (const l of detail.legislation) {
      const label = l.description;
      if (/^[HS]R\s/.test(label)) { skip("simple-resolution"); continue; }
      const b = await bill(l.legislationId);
      if (!b.title) { skip("no-bill-title"); continue; }
      const sum = billSummary({ title: b.title, abstracts: [{ abstract: b.firstReader }] });
      rolls[chamber].push({
        id: `ga-${v.id}-${l.legislationId}`,
        bill: label,
        title: b.title,
        ...(sum.summary ? sum : {}),
        question: caption || undefined,
        kind: classify({ motion_text: caption, motion_classification: /passage|adopt|agree|concur|third read/i.test(caption) ? ["passage"] : [] }),
        outcome: `${v.yea > v.nay ? "Passed" : "Failed"} ${v.yea}–${v.nay}`,
        date: day,
        dateLabel: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`,
        sourceUrl: `https://www.legis.ga.gov/legislation/${l.legislationId}`,
        votes,
      });
    }
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-ga-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("ga", chamber),
    sourceLabel: `Roll call · Georgia ${chamber === "lower" ? "House" : "Senate"} floor votes (Georgia General Assembly)`,
    keyBy: "openstates",
    jurisdiction: "ga",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.filter((r) => r.summary).length} with official summary`);
}
console.log("skipped:", skipped, "| tally mismatches:", tallyMismatch);
await browser.close();
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
