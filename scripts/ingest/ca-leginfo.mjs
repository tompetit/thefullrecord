/**
 * California 2025-26 floor votes from the Legislature's official bulk download
 * (https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip, ~1.3 GB, refreshed daily).
 * Replaces the sampled Open States files state-ca-{lower,upper}.json with every Assembly and
 * Senate floor roll call, plus the Legislative Counsel's Digest as the (official) bill summary.
 *
 * Tables used (tab-delimited .dat, backtick-quoted strings, NULL for empty):
 *   BILL_SUMMARY_VOTE_TBL  one row per roll call (location, time, ayes/noes/abstain, result, motion_id)
 *   BILL_DETAIL_VOTE_TBL   one row per member (voting name, AYE/NOE/ABS)
 *   BILL_MOTION_TBL        motion text
 *   BILL_VERSION_TBL(+lob) latest version's XML: title (GeneralSubject) and DigestText
 *   LEGISLATOR_TBL         voting name -> district; district + family name -> Open States person
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/ca.csv.
 * Votes by people who are not in that roster (members who have left) cannot be linked and are dropped.
 * ABS is "abstain/absent/not voting" in California (there is no "present"), so it maps to "absent".
 *
 * Run: node scripts/ingest/ca-leginfo.mjs [--zip path/to/pubinfo_2025.zip] [--work dir]
 * Without --zip the archive is downloaded into --work (default: OS temp dir) and reused if present.
 */
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { billSummary, classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const ZIP_URL = "https://downloads.leginfo.legislature.ca.gov/pubinfo_2025.zip";
const ROSTER_URL = "https://data.openstates.org/people/current/ca.csv";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHAMBER = { AFLOOR: "lower", SFLOOR: "upper" };
const POSITION = { AYE: "yes", NOE: "no", ABS: "absent" };

const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const work = flag("--work") ?? join(tmpdir(), "ca-leginfo");
mkdirSync(work, { recursive: true });
let zip = flag("--zip");
if (!zip) {
  zip = join(work, "pubinfo_2025.zip");
  if (!existsSync(zip)) {
    console.log(`Downloading ${ZIP_URL} ...`);
    const res = await politeGet(ZIP_URL, { minGapMs: 0 });
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
  }
}
const unzip = (names) => { for (let i = 0; i < names.length; i += 400) execFileSync("unzip", ["-q", "-o", "-d", work, zip, ...names.slice(i, i + 400)]); };

/** Parse a .dat table into arrays of strings (null for NULL). */
function table(name) {
  return readFileSync(join(work, name), "utf8").split("\n").filter(Boolean)
    .map((l) => l.split("\t").map((v) => (v === "NULL" ? null : v.replace(/^`|`$/g, ""))));
}
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
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

unzip(["BILL_SUMMARY_VOTE_TBL.dat", "BILL_DETAIL_VOTE_TBL.dat", "BILL_MOTION_TBL.dat", "BILL_VERSION_TBL.dat", "LEGISLATOR_TBL.dat"]);

// --- Roster: (house, voting name) -> district(s) -> Open States person, requiring the family name to agree.
const people = csv(await (await politeGet(ROSTER_URL)).text());
const personAt = new Map(people.map((p) => [`${p.current_chamber}:${p.current_district}`, p]));
// Members who left office mid-session are not in the current roster; fall back to Open States' retired
// list (one file per person, "First-Last-<uuid>.yml"), matched on full first + last name.
const retired = new Map();
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/ca/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (m) retired.set(norm(m[1]), `ocd-person/${m[2]}`);
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const nameToPerson = new Map(); // "lower:lastname" -> id | null (ambiguous)
for (const r of table("LEGISLATOR_TBL.dat")) {
  const [district, , , house, voting, first, last] = r;
  if (!voting || !district) continue;
  const chamber = house === "A" ? "lower" : "upper";
  const p = personAt.get(`${chamber}:${Number(district.slice(2))}`);
  const id = p && norm(p.family_name) === norm(last ?? voting.split(" ").pop()) ? p.id : retired.get(norm(`${first} ${last}`));
  if (!id) continue;
  const key = `${chamber}:${norm(voting)}`;
  nameToPerson.set(key, nameToPerson.get(key) && nameToPerson.get(key) !== id ? null : id);
}

// --- Roll calls.
const motions = new Map(table("BILL_MOTION_TBL.dat").map((r) => [r[0], r[1]]));
const summaries = table("BILL_SUMMARY_VOTE_TBL.dat").filter((r) => CHAMBER[r[1]] && r[0].startsWith("202520260"));
const rollKey = (bill, loc, when, seq) => `${bill}|${loc}|${when}|${seq}`;
const members = new Map(); // rollKey -> [[name, code]]
for (const r of table("BILL_DETAIL_VOTE_TBL.dat")) {
  if (!CHAMBER[r[1]]) continue;
  const k = rollKey(r[0], r[1], r[3], r[4]);
  (members.get(k) ?? members.set(k, []).get(k)).push([r[2], r[5]]);
}

// --- Latest bill version (title + Legislative Counsel's Digest) for every voted bill.
const latest = new Map();
for (const r of table("BILL_VERSION_TBL.dat")) {
  if (r[15] !== "Y" || !r[14]) continue;
  const cur = latest.get(r[1]);
  if (!cur || r[3] >= cur[3]) latest.set(r[1], r);
}
const billIds = [...new Set(summaries.map((r) => r[0]))];
unzip(billIds.map((b) => latest.get(b)?.[14]).filter(Boolean));
const billInfo = new Map();
for (const b of billIds) {
  const file = latest.get(b)?.[14];
  if (!file || !existsSync(join(work, file))) continue;
  const xml = readFileSync(join(work, file), "utf8");
  const title = decodeXml(/<caml:GeneralSubject><caml:Subject>([\s\S]*?)<\/caml:Subject>/.exec(xml)?.[1] ?? "");
  const digest = decodeXml(/<caml:DigestText>([\s\S]*?)<\/caml:DigestText>/.exec(xml)?.[1] ?? "");
  billInfo.set(b, { title, ...billSummary({ title, abstracts: [{ abstract: digest }] }) });
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const unmatched = new Map(); const skipped = {}; let tallyMismatch = 0;
for (const [bill, loc, when, seq, motionId, ayes, noes, abstain, result] of summaries) {
  const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const chamber = CHAMBER[loc];
  const info = billInfo.get(bill);
  const m = /^202520260([A-Z]+)(\d+)$/.exec(bill);
  const day = when.slice(0, 10);
  if (!m || !info?.title) { skip("no-bill-title"); continue; }
  if (!/^\((PASS|FAIL)\)$/.test(result ?? "")) { skip("no-result"); continue; }
  const raw = members.get(rollKey(bill, loc, when, seq)) ?? [];
  const votes = {};
  for (const [name, code] of raw) {
    const id = nameToPerson.get(`${chamber}:${norm(name)}`);
    if (!id) { unmatched.set(`${chamber}:${name}`, (unmatched.get(`${chamber}:${name}`) ?? 0) + 1); continue; }
    if (POSITION[code]) votes[`${id}`] = POSITION[code];
  }
  if (!Object.keys(votes).length) { skip("no-matched-voters"); continue; }
  if (raw.filter((x) => x[1] === "AYE").length !== Number(ayes) || raw.filter((x) => x[1] === "NOE").length !== Number(noes)) tallyMismatch++;
  const motion = motions.get(motionId) ?? undefined;
  const bn = `${m[1]} ${Number(m[2])}`;
  rolls[chamber].push({
    id: `ca-${bill.slice(9)}-${loc}-${motionId}-${seq}`,
    bill: bn,
    title: info.title,
    ...(info.summary ? { summary: info.summary, summarySource: info.summarySource } : {}),
    question: motion,
    kind: classify({ motion_text: motion, motion_classification: /3rd reading|third reading|concurrence/i.test(motion ?? "") ? ["passage"] : [] }),
    outcome: `${result === "(PASS)" ? "Passed" : "Failed"} ${ayes}–${noes}`,
    date: day,
    dateLabel: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`,
    sourceUrl: `https://leginfo.legislature.ca.gov/faces/billVotesClient.xhtml?bill_id=${bill}`,
    votes,
  });
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const label = snapshotChamberName("ca", chamber);
  const name = chamber === "lower" ? "Assembly" : "Senate";
  await writeSnapshot(join(OUT, `state-ca-${chamber}.json`), {
    generatedAt: now,
    chamber: label,
    sourceLabel: `Roll call · California ${name} floor votes (California Legislative Information)`,
    keyBy: "openstates",
    jurisdiction: "ca",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.filter((r) => r.summary).length} with Legislative Counsel's Digest`);
}
console.log("skipped:", skipped, "| tally mismatches (before dropping unmapped members):", tallyMismatch);
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
