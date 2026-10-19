/**
 * North Carolina 2025-26 session floor votes from the General Assembly's own site (https://www.ncleg.gov).
 * Replaces any sampled Open States files state-nc-{lower,upper}.json with every House and Senate roll call.
 *
 * Page (server-rendered HTML, plain GET):
 *   /Legislation/Votes/RollCallVoteTranscript/2025/{H|S}/{n}   n = 1.. consecutive per chamber; bill, short title, motion,
 *   time, outcome, Ayes/Noes/Not Voting/Excused Absence counts and per-member surnames grouped by party.
 * A roll-call number that does not exist returns 200 with no "Total votes"; 15 missing numbers in a row end a chamber.
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/nc.csv (+ Open States' retired list)
 * from the printed label ("Brown", "G. Brown", "Charles Smith") by chamber, then party group when a label fits several.
 * Not Voting and Excused Absence/Vote are stored as "absent". NC publishes no official bill summary, so none is stored.
 *
 * Responses are cached in --work (default ~/.cache/nc-leg); <= 3 requests/second.
 * Run: node scripts/ingest/nc-leg.mjs [--work dir]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const SITE = "https://www.ncleg.gov";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/nc-leg");
mkdirSync(work, { recursive: true });

const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const text = (html) => decodeXml(html);
function csv(src) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/** Cached GET, 350 ms apart (< 3/s), back off on 429/5xx. */
let last = 0;
async function get(path, name) {
  const file = join(work, name);
  if (existsSync(file)) return readFileSync(file, "utf8");
  for (let attempt = 0; ; attempt++) {
    const wait = last + 350 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const res = await fetch(`${SITE}${path}`, { signal: AbortSignal.timeout(60_000), headers: { "User-Agent": "thefullrecord-ingest/1.0 (civic transparency)" } });
      if (!res.ok) throw new Error(`${path} -> ${res.status}`);
      const body = await res.text();
      writeFileSync(file, body);
      return body;
    } catch (e) {
      if (attempt >= 8) throw e;
      await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
    }
  }
}

// --- Roster.
const people = csv(await (await politeGet("https://data.openstates.org/people/current/nc.csv")).text());
const cands = []; // { id, given, family, party, chamber }
for (const p of people) cands.push({ id: p.id, given: norm(p.given_name), family: norm(p.family_name), last: norm(p.family_name.split(" ").at(-1)), party: p.current_party, chamber: p.current_chamber });
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/nc/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), family: norm(rest.join("")), last: norm(rest.at(-1) ?? ""), party: null, chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
// Open States keeps two retired records for Graig Meyer (Senate 2023-26 is dea063a9) and two Stevens (Sarah is the House member).
const OVERRIDE = { "upper:meyer": "ocd-person/dea063a9-3548-4ec7-b226-a126d2eea0b2", "lower:stevens": "ocd-person/09099128-27fc-463f-af36-28253d1e7a60" };
const unmatched = new Map(), ambiguous = new Map();
const PARTY = { Democrat: "Democratic", Republican: "Republican" };
function person(chamber, party, rawLabel) {
  const label = norm(rawLabel.replace(/\(.*?\)/g, ""));
  if (OVERRIDE[`${chamber}:${label}`]) return OVERRIDE[`${chamber}:${label}`];
  const fits = cands.filter((c) => [c.family, c.last].some((f) => label === f || label === c.given[0] + f || label === c.given + f));
  for (const stage of [fits.filter((c) => c.chamber === chamber), fits.filter((c) => !c.chamber), fits.filter((c) => c.chamber && c.chamber !== chamber)]) {
    let ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length > 1) ids = [...new Set(stage.filter((c) => !c.party || c.party === PARTY[party]).map((c) => c.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { const k = `${chamber}:${rawLabel}`; ambiguous.set(k, (ambiguous.get(k) ?? 0) + 1); return null; }
  }
  return null;
}

// --- Roll calls.
const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
for (const [chamber, letter] of [["lower", "H"], ["upper", "S"]]) {
  let gap = 0;
  for (let n = 1; gap < 15; n++) {
    const html = await get(`/Legislation/Votes/RollCallVoteTranscript/2025/${letter}/${n}`, `${letter}-${n}.html`);
    if (!html.includes("Total votes:")) { gap++; continue; }
    gap = 0;
    if (n % 200 === 0) console.log(letter, n);
    const field = (k) => text(new RegExp(`${k}:</span>\\s*([^<]*)`).exec(html)?.[1] ?? "");
    const head = /<a href="\/BillLookup\/[^"]+">([^<]+)<\/a>:<\/span>&nbsp;&nbsp;([\s\S]*?)<\/div>\s*<div[^>]*><span[^>]*>Vote:<\/span>&nbsp;&nbsp;([\s\S]*?)<\/div>/.exec(html);
    const tm = /(\d+)\/(\d+)\/(\d{4})/.exec(field("Time"));
    if (!head || !tm) { skip("bad-header"); continue; }
    const bill = text(head[1]), title = text(head[2]), motion = text(head[3]);
    const day = `${tm[3]}-${tm[1].padStart(2, "0")}-${tm[2].padStart(2, "0")}`;
    const count = { yes: Number(field("Ayes")), no: Number(field("Noes")) };
    const votes = {}; let yes = 0, no = 0;
    const POS = { Ayes: "yes", Noes: "no", "Not Voting": "absent", "Excused Absence": "absent", "Excused Vote": "absent" };
    for (const m of html.matchAll(/<span class="font-weight-bold">(Ayes|Noes|Not Voting|Excused Absence|Excused Vote) \(([A-Za-z]+)\)<\/span><\/div>\s*<div class="col-12">([^<]*)<\/div>/g)) {
      const pos = POS[m[1]];
      const names = text(m[3]);
      if (names === "None") continue;
      for (const label of names.split(";").map((s) => s.trim()).filter(Boolean)) {
        if (pos === "yes") yes++; else if (pos === "no") no++;
        const id = person(chamber, m[2], label);
        if (!id) { const k = `${chamber}:${label}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
        votes[id] = pos;
      }
    }
    if (!Object.keys(votes).length) { skip("no-voters"); continue; }
    if (yes !== count.yes || no !== count.no) { skip("tally-mismatch"); continue; }
    rolls[chamber].push({
      id: `nc-${letter}${n}`,
      bill,
      title,
      question: motion || undefined,
      kind: classify({ motion_text: motion, motion_classification: /third reading|for adoption|concur|conference report|passage/i.test(motion) ? ["passage"] : [] }),
      outcome: `${field("Outcome") === "PASS" ? "Passed" : "Failed"} ${yes}–${no}`,
      date: day,
      dateLabel: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`,
      sourceUrl: `${SITE}/Legislation/Votes/RollCallVoteTranscript/2025/${letter}/${n}`,
      votes,
    });
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id, "en", { numeric: true }));
  await writeSnapshot(join(OUT, `state-nc-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("nc", chamber),
    sourceLabel: `Roll call · North Carolina ${chamber === "lower" ? "House" : "Senate"} floor votes (NC General Assembly)`,
    keyBy: "openstates",
    jurisdiction: "nc",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls (${list.at(-1)?.date} to ${list[0]?.date})`);
}
console.log("skipped:", skipped);
console.log("ambiguous labels (votes dropped):", Object.fromEntries(ambiguous));
console.log("unmatched labels (votes dropped):", Object.fromEntries(unmatched));
