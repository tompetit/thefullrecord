/**
 * Alabama 2025 and 2026 Regular Session floor votes from the Legislature's own ALISON service
 * (https://alison.legislature.state.al.us). Replaces any sampled Open States files state-al-{lower,upper}.json with every
 * House and Senate recorded roll call.
 *
 * ALISON's public site is a client-rendered app that reads an unauthenticated GraphQL endpoint (POST
 * https://alison.legislature.state.al.us/graphql, no key or login; introspection is off, so the queries are the ones the
 * site itself sends):
 *   instrumentHistories(where: {sessionAbbreviation, rollCallNbr != null})  one row per bill action with a recorded roll call
 *                                                             (date, body, motion text "... Roll Call 376", yeas, nays)
 *   rollCallVotes(sessionAbbreviation, body, rollCallNbr)     tally and per-member Y/N/A/P/... by full name
 *   instruments(where: {sessionAbbreviation})                 short title of each bill (and actSummary once enacted)
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/al.csv by chamber + surname (+ first
 * name or initial), then Open States' retired list for former members. A name that fits several people is dropped and
 * reported rather than guessed. Y/N are yes/no; absent, pass and abstain are stored as "absent" / "present" (see POSITION).
 * Roll calls whose stored yes/no count differs from the official tally are dropped and counted.
 *
 * Responses are cached in --work (default ~/.cache/al-leg); <= 2.5 requests/second.
 * Run: node scripts/ingest/al-leg.mjs [--work dir]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { politeGet, sleep, writeSnapshot } from "./shared.mjs";
import { billSummary, classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const SITE = "https://alison.legislature.state.al.us";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SESSIONS = ["2025RS", "2026RS"];
const BODY = { House: "lower", Senate: "upper" };
// Y/N are positions; A = absent, P = "pass" (did not vote) -> absent; abstentions -> present. Unknown codes abort the run.
const POSITION = { Y: "yes", N: "no", A: "absent", P: "absent", X: "present", E: "absent" };

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/al-leg");
mkdirSync(work, { recursive: true });

let last = 0;
/** Cached GraphQL POST (cache key = name). */
async function gql(name, query, variables = {}) {
  const file = join(work, name);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  for (let attempt = 0; ; attempt++) {
    last = Math.max(last + 400, Date.now());
    const wait = last - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const res = await fetch(`${SITE}/graphql`, {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: { "content-type": "application/json", "user-agent": "thefullrecord-ingest/1.0 (civic transparency)" },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 429 || res.status === 503) console.log(new Date().toISOString(), res.status, name);
      if (!res.ok) throw new Error(`${name} -> ${res.status}`);
      const json = await res.json();
      if (json.errors) throw Object.assign(new Error(`${name}: ${JSON.stringify(json.errors).slice(0, 300)}`), { fatal: true });
      writeFileSync(file, JSON.stringify(json.data));
      return json.data;
    } catch (e) {
      if (e.fatal || attempt >= 8) throw e;
      await sleep(10000 * (attempt + 1));
    }
  }
}

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

// --- Roster: Open States people (current, then retired).
const people = csv(await (await politeGet("https://data.openstates.org/people/current/al.csv")).text());
const cands = []; // { id, given, family (normalised), chamber (current members only) }
for (const p of people) cands.push({ id: p.id, given: norm(p.given_name), family: norm(p.family_name), full: norm(p.name), chamber: p.current_chamber });
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/al/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), family: norm(rest.join("")), full: norm(m[1]), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const unmatched = new Map(); const ambiguous = new Map();
/** Open States id for a vote-page name ("Pebblin W. Warren", "M. Moore", "Artis 'A.J.' McCampbell"). */
function person(chamber, label) {
  const tokens = label.replace(/['"][^'"]*['"]/g, " ").replace(/,?\s+(Jr|Sr|II|III|IV)\.?$/i, "").trim().split(/\s+/);
  const given = norm(tokens[0]), whole = norm(label);
  const initialOnly = tokens[0].replace(/\./g, "").length === 1;
  const fits = cands.filter((c) => {
    if (c.full === whole) return true;
    const surname = norm(tokens.at(-1));
    if (!(c.family === surname || c.family.endsWith(surname) || c.full.endsWith(surname))) return false;
    return initialOnly ? c.given[0] === given : (c.given === given || c.given.startsWith(given) || given.startsWith(c.given));
  });
  // Nicknames ("Ivan Smith" is Van Smith, "William M. Beasley" is Billy Beasley): when the given name fits nobody,
  // accept the surname if exactly one current member of this chamber has it.
  if (!fits.length) {
    const surname = norm(tokens.at(-1));
    fits.push(...cands.filter((c) => c.chamber === chamber && c.family === surname));
    if (fits.length > 1) fits.length = 0;
  }
  for (const stage of [fits.filter((c) => c.chamber === chamber), fits.filter((c) => !c.chamber), fits.filter((c) => c.chamber && c.chamber !== chamber)]) {
    const ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { ambiguous.set(`${chamber}:${label}`, (ambiguous.get(`${chamber}:${label}`) ?? 0) + 1); return null; }
  }
  return null;
}

// --- Roll calls (every action row with a roll call number) and bill titles, per session.
const HISTORY = `query($s:String,$o:Int){instrumentHistories(where:{sessionAbbreviation:{eq:$s},rollCallNbr:{ne:null}},limit:500,offset:$o,order:["calendarDate","ASC"]){count data{instrumentNbr calendarDate body matter voteTitle rollCallNbr yeas nays committee}}}`;
const BILLS = `query($s:String,$o:Int){instruments(where:{sessionAbbreviation:{eq:$s}},limit:500,offset:$o,order:["instrumentNbr","ASC"]){count data{instrumentNbr shortTitle instrumentType actSummary}}}`;
const VOTES = `query($s:String!,$b:LegislativeBody!,$n:Int!){rollCallVotes(sessionAbbreviation:$s,body:$b,rollCallNbr:$n){yeas nays abstains passes votes{memberName vote}}}`;

async function pages(name, query, key, session) {
  const out = [];
  for (let o = 0; ; o += 500) {
    const d = (await gql(`${name}-${session}-${o}.json`, query, { s: session, o }))[key];
    out.push(...d.data);
    if (o + 500 >= d.count) return out;
  }
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
const codes = {};
let tallyMismatch = 0, nelsonKept = 0;
const NELSON = people.find((p) => p.name === "Kristin Nelson")?.id;
for (const session of SESSIONS) {
  const history = await pages("history", HISTORY, "instrumentHistories", session);
  const titles = new Map((await pages("bills", BILLS, "instruments", session)).map((b) => [b.instrumentNbr, b]));
  console.log(session, history.length, "roll-call actions,", titles.size, "bills");
  // Warm the cache with a few requests in flight (start rate stays <= 2.5/s, see gql()).
  const todo = [...new Map(history.filter((h) => BODY[h.body] && titles.has(h.instrumentNbr)).map((h) => [`${h.body}:${h.rollCallNbr}`, h])).values()];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let h; (h = todo.shift());) await gql(`votes-${session}-${h.body}-${h.rollCallNbr}.json`, VOTES, { s: session, b: h.body, n: h.rollCallNbr });
  }));
  const seen = new Set();
  let n = 0;
  for (const h of history) {
    const chamber = BODY[h.body];
    const key = `${h.body}:${h.rollCallNbr}`;
    if (!chamber) { skip("unknown-body"); continue; }
    if (seen.has(key)) { skip("duplicate-roll-call"); continue; }
    seen.add(key);
    if (++n % 200 === 0) console.log(`${session} ${n}/${history.length}`);
    const bill = titles.get(h.instrumentNbr);
    if (!bill) { skip("no-bill"); continue; }
    const rc = (await gql(`votes-${session}-${h.body}-${h.rollCallNbr}.json`, VOTES, { s: session, b: h.body, n: h.rollCallNbr })).rollCallVotes;
    if (!rc?.votes?.length) { skip("no-votes"); continue; }
    const votes = {}; let yes = 0, no = 0, missed = false;
    for (const v of rc.votes) {
      codes[v.vote] = (codes[v.vote] ?? 0) + 1;
      const pos = POSITION[v.vote];
      if (!pos) throw new Error(`Unknown vote code ${JSON.stringify(v)}`);
      if (pos === "yes") yes++; else if (pos === "no") no++;
      const id = person(chamber, v.memberName);
      if (!id) { const k = `${chamber}:${v.memberName}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); missed = true; continue; }
      votes[id] = pos;
    }
    if (!Object.keys(votes).length) { skip("no-matched-voters"); continue; }
    // Only exception: ALISON's House list omits Rep. Kristin Nelson but its tally counts her yes (one yes short, all listed names matched); her vote is not inferred.
    const nelsonGap = chamber === "lower" && !missed && !Object.keys(votes).includes(NELSON) && yes + 1 === rc.yeas && yes + 1 === h.yeas && no === rc.nays && no === h.nays;
    if (!nelsonGap && (yes !== rc.yeas || no !== rc.nays || yes !== h.yeas || no !== h.nays)) { tallyMismatch++; continue; }
    if (nelsonGap) nelsonKept++;
    const question = h.matter.replace(/\s*-?\s*(Adopted|Failed|Passed|Lost|Not Adopted|Defeated)?\s*Roll Call \d+\s*$/i, "").trim() || h.matter;
    const outcome = /\b(Failed|Lost|Not Adopted|Defeated)\b/i.test(h.matter) ? "Failed" : /\b(Adopted|Passed|Carried)\b/i.test(h.matter) ? "Passed" : rc.yeas > rc.nays ? "Passed" : "Failed";
    const { summary, summarySource } = billSummary({ title: bill.shortTitle, abstracts: [{ abstract: bill.actSummary }] });
    rolls[chamber].push({
      id: `al-${session.toLowerCase()}-${h.body[0].toLowerCase()}${h.rollCallNbr}`,
      bill: h.instrumentNbr,
      title: bill.shortTitle || h.instrumentNbr,
      ...(summary ? { summary, summarySource } : {}),
      question,
      kind: classify({ motion_text: question, motion_classification: /pass|concur|third reading/i.test(question) ? ["passage"] : [] }),
      outcome: `${outcome} ${rc.yeas}–${rc.nays}`,
      date: h.calendarDate,
      dateLabel: `${MONTHS[Number(h.calendarDate.slice(5, 7)) - 1]} ${Number(h.calendarDate.slice(8, 10))}, ${h.calendarDate.slice(0, 4)}`,
      sourceUrl: `${SITE}/bill-search?tab=1&search=${encodeURIComponent(h.instrumentNbr)}`,
      votes,
    });
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-al-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("al", chamber),
    sourceLabel: `Roll call · Alabama ${chamber === "lower" ? "House" : "Senate"} floor votes (Alabama Legislature, ALISON)`,
    keyBy: "openstates",
    jurisdiction: "al",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls (${list[list.length - 1]?.date} to ${list[0]?.date}), ${list.filter((r) => r.summary).length} with official summary`);
}
console.log("vote codes:", codes);
console.log("skipped:", skipped, "| tally mismatches dropped:", tallyMismatch, "| kept with Nelson gap:", nelsonKept);
console.log("ambiguous names (votes dropped):", Object.fromEntries(ambiguous));
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
