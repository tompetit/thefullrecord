/**
 * West Virginia 2025 and 2026 regular-session House and Senate floor roll calls from the Legislature's own roll-call PDFs.
 * Replaces the sampled Open States files state-wv-{lower,upper}.json.
 *
 * Sources (plain GETs, allowed by robots.txt):
 *   https://www.wvlegislature.gov/Bill_Status/votes.cfm?year=YYYY&sessiontype=RS&btype=bill  every bill/resolution roll call: bill, short title, date, motion, PDF link
 *   /legisdocs/YYYY/RS/votes/house/NNNNN.pdf and /senate/MM-DD-NNNN.pdf                      printed tally + every member's position
 * (Special sessions 1X-7X list no votes for 2025 or 2026.) Members are keyed "ocd-person/<uuid>" via
 * https://data.openstates.org/people/current/wv.csv plus Open States' retired list. A roll call whose parsed yes/no counts
 * differ from the printed tally is dropped. Absent/excused/not voting are stored as "absent". WV publishes no per-vote
 * summary, so none is stored.
 *
 * Needs pypdf (PYTHONPATH=/tmp/claude-1000/pp). Cache: --work (default ~/.cache/wv-leg); ~2.5 requests/second.
 * Resumable: rerun until it stops saying "downloads incomplete"; --max-downloads N bounds one run.
 * Run: node scripts/ingest/wv-leg.mjs [--work dir] [--max-downloads N]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const SITE = "https://www.wvlegislature.gov";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YEARS = [2025, 2026];

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/wv-leg");
const maxDownloads = args.includes("--max-downloads") ? Number(args[args.indexOf("--max-downloads") + 1]) : Infinity;
mkdirSync(join(work, "pdf"), { recursive: true });

const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
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

// --- Roster.
const people = csv(await (await politeGet("https://data.openstates.org/people/current/wv.csv")).text());
const cands = []; // { id, given, names, chamber (current members only) }
for (const p of people) cands.push({ id: p.id, given: norm(p.given_name), names: new Set([norm(p.family_name), norm(p.family_name.split(" ").at(-1))]), chamber: p.current_chamber });
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/wv/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), names: new Set([norm(rest.join("")), norm(rest.at(-1) ?? "")]), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const unmatched = new Map(), ambiguous = new Map();
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
/** Open States id for a vote-sheet surname (+ initial when given); null (and counted) when unknown or shared by several people. */
// Sheets print a bare surname while only one member of that name sits (checked against wvlegislature.gov news):
// Bryan Ward until Guy Ward's 29 Jan 2026 swearing-in; Mark Maynard until Zack Maynard's 5 Nov 2025 swearing-in (no 2025-26
// sheet before then prints a bare Maynard for Zack); Chris Pritt (David Elliott Pritt left long ago).
const BARE = { "lower:ward": "ocd-person/6e588e9a-4d48-444d-92b4-629e00900440", "upper:maynard": "ocd-person/e98e90d4-7e6d-47e0-b837-6f5f8b492d9c", "lower:pritt": "ocd-person/0d824d1b-fea4-42aa-ab59-9a4dc542dbd2" };
function person(chamber, surname, initials) {
  if (!initials && BARE[`${chamber}:${norm(surname)}`]) return BARE[`${chamber}:${norm(surname)}`];
  const k = norm(surname), i = norm(initials ?? "")[0];
  const bySurname = cands.filter((c) => c.names.has(k));
  for (const stage of [bySurname.filter((c) => c.chamber === chamber), bySurname.filter((c) => !c.chamber), bySurname.filter((c) => c.chamber && c.chamber !== chamber)]) {
    let ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length > 1 && i) ids = [...new Set(stage.filter((c) => c.given[0] === i).map((c) => c.id))];
    if (i && ids.length === 1 && !stage.some((c) => c.id === ids[0] && c.given[0] === i)) continue; // same surname, other first initial (Clark, T vs Wayne Clark)
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { bump(ambiguous, `${chamber}:${surname} ${initials ?? ""}`); return null; }
  }
  return null;
}

// --- Roll-call lists.
async function cached(file, url) {
  if (existsSync(file)) return readFileSync(file, "utf8");
  const text = await (await politeGet(url, { minGapMs: 400 })).text();
  writeFileSync(file, text);
  return text;
}
const rows = []; // { year, chamber, key, bill, title, date, motion, href }
const seen = new Set();
for (const year of YEARS) {
  const html = await cached(join(work, `votes-${year}.html`), `${SITE}/Bill_Status/votes.cfm?year=${year}&sessiontype=RS&btype=bill`);
  for (const tr of html.match(/<tr>\s*<td class="tdborder">[\s\S]*?<\/tr>/g) ?? []) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    const link = /href="(\/legisdocs\/\d{4}\/RS\/votes\/(house|senate)\/([^"]+)\.pdf)">([\s\S]*?)<\/a>/.exec(tds[3] ?? "");
    const d = /(\d\d)\/(\d\d)\/(\d{4})/.exec(tds[2] ?? "");
    if (tds.length < 4 || !link || !d || seen.has(link[1])) continue;
    seen.add(link[1]);
    rows.push({
      year, chamber: link[2] === "house" ? "lower" : "upper", key: link[3],
      bill: decodeXml(tds[0]), title: decodeXml(tds[1]), date: `${d[3]}-${d[1]}-${d[2]}`,
      motion: decodeXml(link[4]).replace(/\s*\(Roll No\. \d+\)\s*$/, ""), href: link[1],
    });
  }
}
console.log(`${rows.length} roll calls listed (${rows.filter((r) => r.chamber === "lower").length} House, ${rows.filter((r) => r.chamber === "upper").length} Senate)`);

// --- Download.
const fileOf = (r) => join(work, "pdf", `${r.chamber === "lower" ? "h" : "s"}${r.year}-${r.key}.pdf`);
let fetched = 0;
for (const r of rows) {
  if (existsSync(fileOf(r))) continue;
  if (fetched >= maxDownloads) break;
  try { writeFileSync(fileOf(r), Buffer.from(await (await politeGet(SITE + r.href, { minGapMs: 400 })).arrayBuffer())); fetched++; }
  catch (e) { console.warn(`skip ${r.href}: ${e.message}`); if (/-> 404$/.test(e.message)) writeFileSync(fileOf(r), ""); } // empty file = listed but not published; counted as unparsed
}
const missing = rows.filter((r) => !existsSync(fileOf(r))).length;
console.log(`downloaded ${fetched}, ${missing} still missing`);
if (missing) { console.log("downloads incomplete; rerun to continue"); process.exit(0); }
for (const [mode, prefix] of [["layout", "h"], ["plain", "s"]]) {
  const files = readdirSync(join(work, "pdf")).filter((f) => f.startsWith(prefix) && f.endsWith(".pdf") && !existsSync(join(work, "pdf", f.replace(/pdf$/, "txt")))).map((f) => join(work, "pdf", f));
  for (let i = 0; i < files.length; i += 200)
    execFileSync("python3", [join(ROOT, "scripts/ingest/pdf-batch.py"), mode, ...files.slice(i, i + 200)], { stdio: "inherit" });
}
const read = (r) => { try { return readFileSync(fileOf(r).replace(/pdf$/, "txt"), "utf8"); } catch { return null; } };

// --- Parse.
const SECTION = { YEAS: "yes", NAYS: "no", "NOT VOTING": "absent", EXCUSED: "absent", ABSENT: "absent" };
function parseHouse(t) {
  const tally = /Yeas:\s*(\d+)\s+Nays:\s*(\d+)\s+Absent:\s*(\d+)\s+Exc:\s*(\d+)/.exec(t);
  if (!tally) return null;
  const votes = []; let pos = null;
  for (const line of t.slice(tally.index + tally[0].length).split("\n")) {
    const h = /^\s*(YEAS|NAYS|NOT VOTING|EXCUSED|ABSENT):\s*\d*\s*$/.exec(line);
    if (h) { pos = SECTION[h[1]]; continue; }
    if (!pos || !line.trim()) continue;
    for (const name of line.trim().split(/\s{2,}/)) votes.push({ pos, name });
  }
  return { yes: +tally[1], no: +tally[2], votes };
}
function parseSenate(t) {
  const tally = /Yea:\s*(\d+)\s+Nay:\s*(\d+)\s+Absent:\s*(\d+)\s+Excused:\s*(\d+)/.exec(t);
  if (!tally) return null;
  const votes = [];
  for (const line of t.slice(tally.index + tally[0].length).split("\n")) {
    if (/^(SEQ\. NO|\d+(st|nd|rd|th) Reading)/.test(line.trim())) break;
    let cur = null;
    for (const tk of line.trim().split(/\s+/)) {
      if (/^[YNAEP]$/.test(tk)) { if (cur) votes.push(cur); cur = { code: tk, name: [] }; }
      else if (cur) cur.name.push(tk);
    }
    if (cur) votes.push(cur);
  }
  const POSN = { Y: "yes", N: "no", A: "absent", E: "absent", P: "absent" };
  return { yes: +tally[1], no: +tally[2], votes: votes.map((v) => ({ pos: POSN[v.code], name: v.name.join(" ") })) };
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const dropped = {}, droppedIds = {};
const drop = (why, id) => { dropped[why] = (dropped[why] ?? 0) + 1; (droppedIds[why] ??= []).push(id); };
// The votes.cfm label ("Passed House", "Amendment rejected", "Dispensed with Constitutional Rule", "Effective from passage")
// is the official result when it reports a failure, but a success-sounding label is not taken on its own: a few listings
// say "Dispensed"/"passed" over a printed tally that cannot carry the motion (House 2026 roll 347, HB 5525 "Dispensed with
// Constitutional Rule" 46-47; 2025 roll 384, HCR 43 "concurred ... and passed" 19-75). So the printed tally must also meet
// the vote the motion needs:
//  - W. Va. Const. art. VI, sec. 29: the three-readings rule may be dispensed with only "by a vote of four-fifths of the
//    members present, taken by yeas and nays". Members present is at least yeas + nays, so yeas < 4/5 of that is a failure.
//  - W. Va. Const. art. VI, sec. 30: an act takes effect ninety days from passage unless "two-thirds of the members elected
//    to each house, by a vote taken by yeas and nays, otherwise direct" (House 100, Senate 34 members).
//  - Anything else: a majority of those voting (yeas > nays).
// Second-reference and House-rule suspensions are majority votes here; the PDF prints no result line of its own.
const ELECTED = { lower: 100, upper: 34 };
function yeasNeeded(chamber, motion, yes, no) {
  if (/constitutional rule|dispensed with/i.test(motion) && !/reference/i.test(motion)) return Math.max(no + 1, Math.ceil((4 * (yes + no)) / 5));
  if (/^Effective\b|concurred in Senate effective date/i.test(motion)) return Math.max(no + 1, Math.ceil((2 * ELECTED[chamber]) / 3));
  return no + 1;
}
const PROC = /constitutional rule|dispensed|previous question|discharge|refer|table|2nd reference|limit debate|withdraw suspension|restricted right|reconsider|effective/i;
for (const r of rows) {
  const t = read(r); const p = t && (r.chamber === "lower" ? parseHouse(t) : parseSenate(t));
  if (!p) { drop(`${r.chamber}-unparsed`, r.href); continue; }
  const votes = {};
  for (const { pos, name } of p.votes) {
    const speaker = /^Speaker (.+)$/.exec(name);
    const [surname, initials] = r.chamber === "lower"
      ? (speaker ? [speaker[1], undefined] : name.split(/\s*,\s*/))
      : name === "MR PRESIDENT" ? ["Smith", "R"] : name.split(/\s*,\s*/);
    const pid = person(r.chamber, surname, initials);
    if (!pid) { bump(unmatched, `${r.chamber}:${name}`); continue; }
    votes[pid] = pos;
  }
  const yes = Object.values(votes).filter((v) => v === "yes").length, no = Object.values(votes).filter((v) => v === "no").length;
  const listedYes = p.votes.filter((v) => v.pos === "yes").length, listedNo = p.votes.filter((v) => v.pos === "no").length;
  if (yes !== p.yes || no !== p.no || listedYes !== p.yes || listedNo !== p.no) { drop(`${r.chamber}-tally-mismatch`, `${r.href} parsed ${yes}-${no} listed ${listedYes}-${listedNo} printed ${p.yes}-${p.no}`); continue; }
  const failed = /reject|fail|defeat/i.test(r.motion) && !/adopted/i.test(r.motion);
  const word = !failed && p.yes >= yeasNeeded(r.chamber, r.motion, p.yes, p.no) ? "Passed" : "Failed";
  rolls[r.chamber].push({
    id: `wv-${r.chamber === "lower" ? "h" : "s"}${r.year}-${r.key}`,
    bill: r.bill, title: r.title, question: r.motion || undefined,
    kind: /passed|passage|conference report|concurred/i.test(r.motion) && !PROC.test(r.motion.replace(/concurred/i, "")) ? "substantive" : PROC.test(r.motion) ? "procedural" : classify({ motion_text: r.motion }),
    outcome: `${word} ${p.yes}–${p.no}`,
    date: r.date, dateLabel: `${MONTHS[Number(r.date.slice(5, 7)) - 1]} ${Number(r.date.slice(8, 10))}, ${r.date.slice(0, 4)}`,
    sourceUrl: SITE + r.href, votes,
  });
}
console.log("dropped:", dropped);
console.log("ambiguous (votes dropped):", Object.fromEntries(ambiguous));
console.log("unmatched members (votes dropped):", Object.fromEntries(unmatched));
console.log("dropped ids:", JSON.stringify(droppedIds).slice(0, 3000));
for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id, "en", { numeric: true }));
  await writeSnapshot(join(OUT, `state-wv-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("wv", chamber),
    sourceLabel: `Roll call · West Virginia ${chamber === "lower" ? "House of Delegates" : "Senate"} floor votes (WV Legislature)`,
    keyBy: "openstates",
    jurisdiction: "wv",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.at(-1)?.date} to ${list[0]?.date}`);
}
