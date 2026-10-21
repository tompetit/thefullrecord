/**
 * Nevada 2025 floor votes from the Legislature's own NELIS site (https://www.leg.state.nv.us/App/NELIS/REL/):
 * the 83rd (2025) Regular Session and the 36th (2025) Special Session. Nevada has no 2026 session.
 * Replaces any sampled Open States files state-nv-{lower,upper}.json with every Assembly and Senate floor roll call
 * (final passage, concurrence, veto override ... whatever the bill's Votes tab lists; committee votes are not imported),
 * plus the official bill summary and title.
 *
 * Pages (server-rendered HTML fragments, plain GET):
 *   /{session}/HomeBill/BillsTab?Page=n&Filters.PageSize=50&SelectedBillTypes=AB   bill list (id + official summary)
 *   /{session}/Bill/FillSelectedBillTab?selectedTab=Votes&billKey=id               vote types for a bill
 *   /{session}/Bill/GetBillVotes?billKey=id&voteTypeId=n                           chamber, result, date, tallies, voteKeys
 *   /{session}/Bill/GetBillVoteMembers?voteKey=k&voteResultPanel=All               "Surname, First" (Yea|Nay|Excused|Not Voting|Absent)
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/nv.csv by chamber + surname +
 * first-name prefix (the site truncates first names), then Open States' retired list; ambiguous names are dropped and
 * reported. Excused, Not Voting and Absent are stored as "absent". Simple resolutions (AR/SR) are omitted.
 *
 * Responses are cached in --work (default ~/.cache/nv-leg); <= 3 requests/second.
 * Run: node scripts/ingest/nv-leg.mjs [--work dir]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, sleep, writeSnapshot } from "./shared.mjs";
import { billSummary, classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const SITE = "https://www.leg.state.nv.us/App/NELIS/REL";
const SESSIONS = ["83rd2025", "36th2025Special"];
const BILL_TYPES = ["AB", "SB", "AJR", "SJR", "ACR", "SCR"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CHAMBER = { Assembly: "lower", Senate: "upper" };
const POSITION = { yea: "yes", nay: "no", excused: "absent", "not voting": "absent", absent: "absent" };

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/nv-leg");
mkdirSync(work, { recursive: true });

let last = 0;
/** Cached GET returning the response text (null on 404). Fragments need the XHR header. */
async function get(path, name) {
  const file = join(work, name);
  if (existsSync(file)) return readFileSync(file, "utf8");
  last = Math.max(last + 350, Date.now());
  const wait = last - Date.now();
  if (wait > 0) await sleep(wait);
  const res = await politeGet(`${SITE}${path}`, { retries: 6, minGapMs: 0, allow404: true, headers: { "X-Requested-With": "XMLHttpRequest" } });
  if (!res) return null;
  const body = await res.text();
  writeFileSync(file, body);
  return body;
}
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const text = (html) => decodeXml(html.replace(/<[^>]+>/g, " "));
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

// --- Roster: Open States people (current, then retired).
const people = csv(await (await politeGet("https://data.openstates.org/people/current/nv.csv")).text());
const cands = []; // { id, given, names: normalised surname spellings, chamber (current members only) }
for (const p of people) cands.push({ id: p.id, given: norm(p.given_name), names: new Set([norm(p.family_name), norm(p.family_name.split(/[\s-]/).at(-1))]), chamber: p.current_chamber });
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/nv/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), names: new Set([norm(rest.join("")), norm(rest.at(-1) ?? "")]), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const unmatched = new Map(); const ambiguous = new Map();
const givenFits = (a, b) => !a || !b || a.startsWith(b) || b.startsWith(a);
/** Open States id for a "Surname, First" label; null (and counted) when unknown or shared by several people. */
function person(chamber, label) {
  const [sur, first = ""] = label.split(",").map((s) => s.trim());
  const k = norm(sur), g = norm(first);
  let fits = cands.filter((c) => c.names.has(k));
  if (!fits.length) fits = cands.filter((c) => c.names.has(norm(sur.split(/[\s-]/).at(-1)))); // "Cruz-Crawford" is "Crawford" in Open States
  const exact = fits.filter((c) => givenFits(c.given, g));
  const pool = exact.length ? exact : fits;
  for (const stage of [pool.filter((c) => c.chamber === chamber), pool.filter((c) => !c.chamber), pool.filter((c) => c.chamber && c.chamber !== chamber)]) {
    const ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { ambiguous.set(`${chamber}:${label}`, (ambiguous.get(`${chamber}:${label}`) ?? 0) + 1); return null; }
  }
  return null;
}

// --- Bill list.
const bills = []; // { session, id, name, summary }
for (const session of SESSIONS) {
  for (const type of BILL_TYPES) {
    for (let page = 1; ; page++) {
      const html = await get(`/${session}/HomeBill/BillsTab?Page=${page}&Filters.PageSize=50&SelectedBillTypes=${type}`, `list-${session}-${type}-${page}.html`);
      const rows = html ? [...html.matchAll(/<a id="([A-Z]+\d+)" href="[^"]*\/Bill\/(\d+)\/Overview">[\s\S]*?<div class="col-md-10[^>]*>([\s\S]*?)<\/div>/g)] : [];
      for (const m of rows) bills.push({ session, name: m[1], id: m[2], summary: text(m[3]) });
      if (!rows.length) break; // pages can hold <50 rows mid-list
    }
  }
}
console.log(`${bills.length} bills listed`);

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
let n = 0;
for (const b of bills) {
  if (++n % 100 === 0) console.log(`${n}/${bills.length} bills`);
  const tab = await get(`/${b.session}/Bill/FillSelectedBillTab?selectedTab=Votes&billKey=${b.id}`, `tab-${b.session}-${b.id}.html`);
  const types = [...(tab ?? "").matchAll(/voteTypeId=(\d+)">([^<]*)</g)];
  if (!types.length) continue;
  const title = b.summary.replace(/\s*\(BDR\s*[A-Z]*-?\d+\)\s*$/, "");
  const { summary, summarySource } = billSummary({ title: b.name, abstracts: [{ abstract: title }] });
  for (const [, typeId, typeLabel] of types) {
    const html = await get(`/${b.session}/Bill/GetBillVotes?billKey=${b.id}&voteTypeId=${typeId}`, `votes-${b.session}-${b.id}-${typeId}.html`);
    if (!html) { skip("votes-404"); continue; }
    for (const block of html.split('<h2 class="h4">').slice(1)) {
      const chamber = CHAMBER[/^(Assembly|Senate)/.exec(block)?.[1]];
      const voteKey = /voteKey=(\d+)/.exec(block)?.[1];
      const dm = /Date\s*<span>\w+, (\w+) (\d+), (\d{4})/.exec(block);
      const result = text(/<li class="list-group-item[^>]*>\s*<span>([^<]*)<\/span>/.exec(block)?.[1] ?? "");
      if (!chamber || !voteKey || !dm) { skip("bad-block"); continue; }
      const day = `${dm[3]}-${String(MONTH_NAMES.indexOf(dm[1]) + 1).padStart(2, "0")}-${dm[2].padStart(2, "0")}`;
      const count = (k) => Number(new RegExp(`${k}: (\\d+)`).exec(block)?.[1] ?? 0);
      const yea = count("Yea"), nay = count("Nay");
      const mem = await get(`/${b.session}/Bill/GetBillVoteMembers?voteKey=${voteKey}&voteResultPanel=All`, `members-${voteKey}.html`);
      if (!mem) { skip("members-404"); continue; }
      const votes = {}; let yes = 0, no = 0;
      for (const m of mem.matchAll(/\n\s*([^\n<>()]+,[^\n<>()]+?)\s*\r?\n\s*\(\s*([A-Za-z ]+?)\s*\)/g)) {
        const pos = POSITION[m[2].trim().toLowerCase()];
        if (!pos) { skip(`position-${m[2].trim()}`); continue; }
        const label = decodeXml(m[1]).trim();
        if (pos === "yes") yes++; else if (pos === "no") no++;
        const id = person(chamber, label);
        if (!id) { const k = `${chamber}:${label}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
        votes[id] = pos;
      }
      if (yes !== yea || no !== nay) { skip("tally-mismatch"); continue; }
      if (!Object.keys(votes).length) { skip("no-matched-voters"); continue; }
      // NELIS can print "Passed" on a losing tally (e.g. AB500 20–22), so the tally must agree.
      const passed = yea > nay && !/fail|not|sustained/i.test(result);
      rolls[chamber].push({
        id: `nv-${voteKey}`,
        bill: b.name,
        title: title || b.name,
        ...(summary ? { summary, summarySource } : {}),
        question: typeLabel.trim(),
        kind: classify({ motion_text: typeLabel, motion_classification: /final passage|passage|override/i.test(typeLabel) ? ["passage"] : [] }),
        outcome: `${passed ? "Passed" : "Failed"} ${yea}–${nay}`,
        date: day,
        dateLabel: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`,
        sourceUrl: `${SITE}/${b.session}/Bill/${b.id}/Overview`,
        votes,
      });
    }
  }
}

console.log("skipped:", skipped, "| unmatched:", Object.fromEntries(unmatched), "| ambiguous:", Object.fromEntries(ambiguous));
for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-nv-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("nv", chamber),
    sourceLabel: `Roll call · Nevada ${chamber === "lower" ? "Assembly" : "Senate"} floor votes (Nevada Legislature)`,
    keyBy: "openstates",
    jurisdiction: "nv",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls (${list.at(-1)?.date}..${list[0]?.date}), ${list.filter((r) => r.summary).length} with official summary`);
}
console.log("skipped:", skipped);
console.log("ambiguous names (votes dropped):", Object.fromEntries(ambiguous));
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
