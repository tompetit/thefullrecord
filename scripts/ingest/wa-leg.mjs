/**
 * Washington 2025-26 floor votes from the Legislature's official web services
 * (https://wslwebservices.leg.wa.gov/). Replaces the sampled Open States files state-wa-{lower,upper}.json
 * with every House and Senate floor roll call (final passage, amendments, concurrence ...; WA's
 * GetRollCalls only holds floor votes), plus the official bill description as the (official) summary.
 *
 * Endpoints (plain GET, XML):
 *   LegislationService.asmx/GetLegislationByYear?year=   every bill number of the biennium
 *   LegislationService.asmx/GetRollCalls?biennium=&billNumber=   roll calls with per-member Yea/Nay/Absent/Excused
 *   LegislationService.asmx/GetLegislation?biennium=&billNumber=  ShortDescription (title), LongDescription (summary)
 *   SponsorService.asmx/GetSponsors?biennium=   WA member id -> chamber, district, name
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/wa.csv (chamber + district,
 * family name must agree); members who left office fall back to Open States' retired list on full name.
 * Excused and Absent both map to "absent" (not voting). Simple resolutions (HR/SR) are omitted.
 *
 * Responses are cached in --work (default: OS temp dir/wa-leg) so re-runs are cheap; ~5 requests/second.
 * Run: node scripts/ingest/wa-leg.mjs [--work dir]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { billSummary, classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const WS = "https://wslwebservices.leg.wa.gov";
const BIENNIUM = "2025-26";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHAMBER = { House: "lower", Senate: "upper" };
const POSITION = { Yea: "yes", Nay: "no", Absent: "absent", Excused: "absent" };

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(tmpdir(), "wa-leg");
mkdirSync(work, { recursive: true });

/** Cached GET returning response text. */
async function get(path) {
  const file = join(work, path.replace(/[^A-Za-z0-9]+/g, "_"));
  if (existsSync(file)) return readFileSync(file, "utf8");
  const text = await (await politeGet(`${WS}/${path}`, { minGapMs: 200 })).text();
  writeFileSync(file, text);
  return text;
}
const blocks = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
const field = (xml, tag) => decodeXml(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml ?? "")?.[1] ?? "").trim();
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

// --- Roster: WA member id -> Open States person.
const people = csv(await (await politeGet("https://data.openstates.org/people/current/wa.csv")).text());
const inDistrict = (chamber, district) => people.filter((p) => p.current_chamber === chamber && p.current_district === String(district)); // House has two seats per district
const retired = new Map();
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/wa/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (m) retired.set(norm(m[1]), `ocd-person/${m[2]}`);
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const memberPerson = new Map(); // WA member id -> ocd-person id
for (const m of blocks(await get(`SponsorService.asmx/GetSponsors?biennium=${BIENNIUM}`), "Member")) {
  const chamber = CHAMBER[field(m, "Agency")];
  const last = field(m, "LastName");
  const p = inDistrict(chamber, Number(field(m, "District"))).find((x) => norm(x.family_name) === norm(last));
  const id = p ? p.id : retired.get(norm(`${field(m, "FirstName")} ${last}`));
  if (id) memberPerson.set(field(m, "Id"), id);
}

// --- Bill numbers -> base label (HB 1217, SGA 9001 ...); simple resolutions skipped.
const bills = new Map();
for (const year of [2025, 2026]) {
  for (const b of blocks(await get(`LegislationService.asmx/GetLegislationByYear?year=${year}`), "LegislationInfo")) {
    if (field(b, "LongLegislationType") === "Resolution") continue;
    const label = field(b, "BillId").replace(/^[E23S]*(?=[HS][BJCGI][A-Z]*\s)/, "");
    bills.set(field(b, "BillNumber"), label);
  }
}

const info = new Map(); // bill number -> { title, summary }
async function billInfo(num) {
  if (info.has(num)) return info.get(num);
  const items = blocks(await get(`LegislationService.asmx/GetLegislation?biennium=${BIENNIUM}&billNumber=${num}`), "Legislation");
  const first = items.find((x) => field(x, "ShortDescription")) ?? items[0] ?? "";
  const title = field(first, "ShortDescription");
  const long = items.map((x) => field(x, "LongDescription")).find(Boolean) ?? "";
  const r = { title, ...billSummary({ title, abstracts: [{ abstract: long }] }) };
  info.set(num, r);
  return r;
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const unmatched = new Map(); const skipped = {}; let tallyMismatch = 0;
const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
let n = 0;
for (const [num, label] of bills) {
  if (++n % 500 === 0) console.log(`${n}/${bills.size} bills`);
  for (const rc of blocks(await get(`LegislationService.asmx/GetRollCalls?biennium=${BIENNIUM}&billNumber=${num}`), "RollCall")) {
    const chamber = CHAMBER[field(rc, "Agency")];
    const day = field(rc, "VoteDate").slice(0, 10);
    if (!chamber || !/^\d{4}-\d\d-\d\d$/.test(day)) { skip("bad-chamber-or-date"); continue; }
    const yea = Number(field(blocks(rc, "YeaVotes")[0], "Count")), nay = Number(field(blocks(rc, "NayVotes")[0], "Count"));
    const votes = {}; let yes = 0, no = 0;
    for (const v of blocks(rc, "Vote")) {
      const pos = POSITION[field(v, "VOte")];
      const id = memberPerson.get(field(v, "MemberId"));
      if (!pos) continue;
      if (pos === "yes") yes++; else if (pos === "no") no++;
      if (!id) { const k = `${chamber}:${field(v, "Name")}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
      votes[id] = pos;
    }
    if (!Object.keys(votes).length) { skip("no-matched-voters"); continue; }
    if (yes !== yea || no !== nay) tallyMismatch++;
    const bi = await billInfo(num);
    if (!bi.title) { skip("no-bill-title"); continue; }
    const motion = field(rc, "Motion");
    const seq = field(rc, "SequenceNumber");
    const id = `wa-${num}-${chamber === "lower" ? "h" : "s"}-${day}-${seq}`;
    if (rolls[chamber].some((r) => r.id === id)) { skip("duplicate-in-source"); continue; } // WA sometimes lists a roll call twice
    rolls[chamber].push({
      id,
      bill: label,
      title: bi.title,
      ...(bi.summary ? { summary: bi.summary, summarySource: bi.summarySource } : {}),
      question: motion || undefined,
      kind: classify({ motion_text: motion, motion_classification: /final passage|concur/i.test(motion) ? ["passage"] : [] }),
      outcome: `${yea > nay ? "Passed" : "Failed"} ${yea}–${nay}`,
      date: day,
      dateLabel: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`,
      sourceUrl: `https://app.leg.wa.gov/billsummary?BillNumber=${num}&Year=${day.slice(0, 4)}&Initiative=false`,
      votes,
    });
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-wa-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("wa", chamber),
    sourceLabel: `Roll call · Washington ${chamber === "lower" ? "House" : "Senate"} floor votes (Washington State Legislature)`,
    keyBy: "openstates",
    jurisdiction: "wa",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.filter((r) => r.summary).length} with official summary`);
}
console.log("skipped:", skipped, "| tally mismatches:", tallyMismatch);
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
