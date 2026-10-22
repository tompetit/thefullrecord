/**
 * Oregon 2025 regular + 2026 regular (short) session floor votes from the Legislature's official OData API
 * (https://api.oregonlegislature.gov/odata/odataservice.svc/). Replaces the sampled Open States files
 * state-or-{lower,upper}.json with every House and Senate floor roll call (MeasureVotes only; no committee votes),
 * plus the official Measures.MeasureSummary as the (official) summary.
 *
 * Entities (JSON, keyset-paged with $filter + $orderby + $top; ≤ 3 requests/second):
 *   MeasureVotes           per-legislator floor vote (Aye/Nay/Excused ...) grouped by MeasureHistoryId
 *   MeasureHistoryActions  floor action text + official tally (VoteText) for each vote
 *   Measures               CatchLine (title) + MeasureSummary
 *   Legislators            "Rep Smith" / "Sen Smith" code -> chamber, district, last name
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/or.csv (chamber + district,
 * family name must agree); members who left office fall back to Open States' retired list on full name.
 * Excused and Absent both map to "absent". Simple resolutions (HR/SR) are omitted.
 *
 * Responses are cached in --work (default: ~/.cache/or-leg). Run: node scripts/ingest/or-leg.mjs [--work dir]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { politeGet, writeSnapshot } from "./shared.mjs";
import { billSummary, classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const API = "https://api.oregonlegislature.gov/odata/odataservice.svc";
const SESSIONS = ["2025R1", "2026R1"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHAMBER = { H: "lower", S: "upper" };
const POSITION = { Aye: "yes", Nay: "no", Excused: "absent", Absent: "absent", "Excused for Business": "absent" };
const PAGE = 1000;

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/or-leg");
mkdirSync(work, { recursive: true });

/** Cached GET of an OData query, returning .value. */
async function get(query) {
  const file = join(work, query.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 200) + ".json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const res = await politeGet(`${API}/${query}`, { minGapMs: 400, headers: { Accept: "application/json" } });
  const value = (await res.json()).value;
  writeFileSync(file, JSON.stringify(value));
  return value;
}
/** All rows of an entity for a filter, keyset-paged on numeric `key`. */
async function all(entity, filter, key) {
  const rows = []; let last = 0;
  for (;;) {
    const page = await get(`${entity}?$filter=${encodeURIComponent(`${filter} and ${key} gt ${last}`)}&$orderby=${key}&$top=${PAGE}`);
    rows.push(...page);
    if (page.length < PAGE) return rows;
    last = page[page.length - 1][key];
  }
}
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

// --- Roster: OR legislator code ("Rep Smith") -> Open States person.
const people = csv(await (await politeGet("https://data.openstates.org/people/current/or.csv")).text());
const retired = new Map();
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/or/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (m) retired.set(norm(m[1]), `ocd-person/${m[2]}`);
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const codePerson = new Map();
const like = (a, b) => a && b && (a.includes(b) || b.includes(a)); // "Boshart Davis" ~ "Davis", "Manning Jr." ~ "Manning"
for (const s of [...SESSIONS, "2025S1"]) {
  for (const l of await get(`Legislators?$filter=${encodeURIComponent(`SessionKey eq '${s}'`)}`)) {
    const chamber = CHAMBER[l.Chamber];
    const last = norm(l.LastName), first = norm(l.FirstName);
    // same seat first; members who changed chamber (House -> Senate) match on name alone
    const p = people.find((x) => x.current_chamber === chamber && x.current_district === String(Number(l.DistrictNumber)) && like(norm(x.family_name), last))
      ?? people.find((x) => like(norm(x.family_name), last) && norm(x.given_name) === first);
    const id = p ? p.id : retired.get(norm(`${l.FirstName} ${l.LastName.replace(/\s+Jr\.?$/, "")}`));
    if (id && !codePerson.has(`${chamber}:${l.LegislatorCode}`)) codePerson.set(`${chamber}:${l.LegislatorCode}`, id);
  }
}
/** Vote names with no Legislators row (e.g. mid-session appointees): unique surname across current + retired members. */
function bySurname(voteName) {
  const sur = norm(voteName.replace(/^(Rep|Sen)\s+/, "").replace(/\s+Jr\.?$/, ""));
  const hits = [...people.filter((x) => like(norm(x.family_name), sur)).map((x) => x.id), ...[...retired].filter(([k]) => k.endsWith(sur)).map(([, id]) => id)];
  const uniq = [...new Set(hits)];
  return uniq.length === 1 ? uniq[0] : undefined;
}

/**
 * Official result of a floor action, read from the action text ("Third reading. Carried by Gomberg. Failed.",
 * "Motion to withdraw from Rules failed.", "... Passed.", "Motion to table carried."). The tally alone is not enough:
 * Or. Const. Art. IV §25 requires a majority of all members elected (31 of 60 House, 16 of 30 Senate) to pass a bill
 * (three-fifths for revenue bills), and House/Senate rules set the same floor for withdrawing a measure from committee,
 * so e.g. a 28–12 third reading fails. Returns null when the text states no result; the caller then falls back to the tally.
 */
function officialResult(text) {
  const t = String(text ?? "").split(/\bAyes?,\s*\d/)[0].replace(/\bCarried by [^.]*\./gi, ""); // "Carried by X" names the carrier
  if (/\brefused to concur\b/i.test(t)) return null; // records the concurrence motion's fate, not a pass/fail word
  if (/\b(failed|lost)\b/i.test(t)) return "Failed";
  if (/\b(passed|repassed|carried|adopted|readopted|concurred)\b/i.test(t)) return "Passed";
  return null;
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const unmatched = new Map(); const skipped = {}; let tallyMismatch = 0;
const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
for (const session of SESSIONS) {
  const f = `SessionKey eq '${session}'`;
  const measures = new Map();
  for (let skipN = 0; ; skipN += PAGE) {
    const page = await get(`Measures?$filter=${encodeURIComponent(f)}&$orderby=${encodeURIComponent("MeasurePrefix,MeasureNumber")}&$top=${PAGE}&$skip=${skipN}`);
    for (const m of page) measures.set(`${m.MeasurePrefix} ${m.MeasureNumber}`, m);
    if (page.length < PAGE) break;
  }
  const history = new Map((await all("MeasureHistoryActions", `${f} and VoteText ne null`, "MeasureHistoryId")).map((h) => [h.MeasureHistoryId, h]));
  const groups = new Map();
  for (const v of await all("MeasureVotes", f, "MeasureVoteId")) {
    if (!groups.has(v.MeasureHistoryId)) groups.set(v.MeasureHistoryId, []);
    groups.get(v.MeasureHistoryId).push(v);
  }
  console.log(session, `${measures.size} measures, ${groups.size} floor votes`);
  for (const [hid, vs] of groups) {
    const v0 = vs[0];
    const chamber = CHAMBER[v0.Chamber];
    const label = `${v0.MeasurePrefix} ${v0.MeasureNumber}`;
    const day = v0.ActionDate.slice(0, 10);
    const m = measures.get(label);
    if (!chamber || !m || /^[HS]R$/.test(v0.MeasurePrefix)) { skip("resolution-or-unknown"); continue; }
    const votes = {}; let yes = 0, no = 0;
    for (const v of vs) {
      const pos = POSITION[v.Vote];
      if (!pos) { skip(`vote-${v.Vote}`); continue; }
      if (pos === "yes") yes++; else if (pos === "no") no++;
      const id = codePerson.get(`${chamber}:${v.VoteName}`) ?? bySurname(v.VoteName);
      if (!id) { const k = `${chamber}:${v.VoteName}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
      votes[id] = pos;
    }
    if (!Object.keys(votes).length) { skip("no-matched-voters"); continue; }
    const vt = history.get(hid)?.VoteText ?? "";
    const ayes = Number(/Ayes?, (\d+)/.exec(vt)?.[1] ?? yes), nays = Number(/Nays?, (\d+)/.exec(vt)?.[1] ?? 0);
    if (ayes !== yes || nays !== no) tallyMismatch++;
    const title = String(m.CatchLine ?? m.RelatingTo ?? "").replace(/\s+/g, " ").trim();
    if (!title) { skip("no-title"); continue; }
    const summary = billSummary({ title, abstracts: [{ abstract: m.MeasureSummary }] });
    const motion = v0.ActionText;
    rolls[chamber].push({
      id: `or-${session}-${v0.MeasurePrefix}${v0.MeasureNumber}-${v0.Chamber.toLowerCase()}-${hid}`,
      bill: label,
      title,
      ...summary,
      question: motion || undefined,
      kind: classify({ motion_text: motion, motion_classification: /\b(passed|adopted|concur)/i.test(motion) ? ["passage"] : [] }),
      outcome: `${officialResult(motion) ?? (yes > no ? "Passed" : "Failed")} ${yes}–${no}`,
      date: day,
      dateLabel: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`,
      sourceUrl: `https://olis.oregonlegislature.gov/liz/${session}/Measures/Overview/${v0.MeasurePrefix}${v0.MeasureNumber}`,
      votes,
    });
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-or-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("or", chamber),
    sourceLabel: `Roll call · Oregon ${chamber === "lower" ? "House" : "Senate"} floor votes (Oregon State Legislature)`,
    keyBy: "openstates",
    jurisdiction: "or",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.filter((r) => r.summary).length} with official summary`);
}
console.log("skipped:", skipped, "| tally mismatches:", tallyMismatch);
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
