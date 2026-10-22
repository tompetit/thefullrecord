/**
 * South Carolina 126th General Assembly (2025-26) House and Senate floor roll calls from the General Assembly's own
 * site (https://www.scstatehouse.gov). Replaces the sampled Open States files state-sc-{lower,upper}.json.
 *
 * Sources (plain GETs/POSTs of public pages):
 *   POST /votehistory.php  type=CHAMBER&session=126&chamber={H|S}&headerfooter=1   one HTML table of every vote in the
 *                          session: vote number, bill, title + motion, date/time, Yeas/Nays/N-V/Exc.Abs./Pres./Abstain, result
 *   GET  /votehistory.php?KEY={n}   the roll call itself, served as a text PDF: "RESULT: Passed|Failed", then YEAS / NAYS /
 *                          EXCUSED ABSENCE / NOT VOTING name lists ("Last, First M., Jr."), with the printed tally
 * The outcome is that official RESULT (list Result column as backup), not yea > nay.
 * Only votes with a bill number and at least one yea or nay are kept (attendance, officer elections and "Adjourn for
 * the day" rows carry no bill). Members are keyed "ocd-person/<uuid>" from the Open States people CSV by surname (+ given
 * name when two members share one), then Open States' retired list, then the other chamber's members. Excused Absence
 * and Not Voting are stored as "absent". A roll call whose parsed lists do not equal the printed tally is dropped.
 * The site publishes no per-vote summary, so the title is the bill's short title and no summary is stored.
 *
 * Cache: --work (default ~/.cache/sc-leg). <= 3 requests/s. PDFs are read with scripts/ingest/sc-pdf-text.py (pypdf;
 * PYTHONPATH=/tmp/claude-1000/pp). Run: node scripts/ingest/sc-leg.mjs [--work dir]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const SITE = "https://www.scstatehouse.gov";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHAMBERS = { H: "lower", S: "upper" };
const SECTION = { YEAS: "yes", AYES: "yes", NAYS: "no", "EXCUSED ABSENCE": "absent", "NOT VOTING": "absent", PRESENT: "present", "ABSTAIN/RECUSED": "present", ABSTAIN: "present", RECUSED: "present" };
/**
 * Roll calls whose printed RESULT the official House Journal contradicts (KEY -> passed), checked against
 * https://www.scstatehouse.gov/sess126_2025-2026/hj{yy}/{yyyymmdd}.htm:
 *   27445 H 4270, 2026-04-28, Table Motion to Commit, Yeas 80; Nays 22: "So, the motion to commit the Bill was tabled."
 *   25739 H 3927, 2025-04-02, Table Motion to Recommit Bill, Yeas 77; Nays 31: "So, the motion to recommit the Bill was tabled."
 */
const JOURNAL_RESULT = { 27445: true, 25739: true };
const SUFFIX = /^(Jr\.?|Sr\.?|II|III|IV|V|Ph\.D\.?|Esq\.?)$/;

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/sc-leg");
mkdirSync(work, { recursive: true });

const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const cell = (html) => decodeXml(html.replace(/<br\s*\/?>/gi, " | ")).replace(/\s*\|\s*/g, " | ").trim();
function csv(src) {
  const rows = []; let row = [], c = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(c); c = ""; }
    else if (ch === "\n") { row.push(c); rows.push(row); row = []; c = ""; }
    else if (ch !== "\r") c += ch;
  }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// --- Roster: { id, given: Set of normalised given-name tokens, names: Set of surname spellings, chamber|null }
const cands = [];
for (const p of csv(await (await politeGet("https://data.openstates.org/people/current/sc.csv")).text())) {
  cands.push({ id: p.id, given: new Set([norm(p.given_name), ...p.name.split(/\s+/).map(norm)].filter(Boolean)), names: new Set([norm(p.family_name), norm(p.family_name.split(" ").at(-1))]), chamber: p.current_chamber });
}
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/sc/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const toks = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: new Set(toks.map(norm)), names: new Set([norm(toks.slice(1).join("")), norm(toks.at(-1) ?? ""), ...toks.map(norm)]), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }

const unmatched = new Map(), ambiguous = new Set();
/** Open States id for "Surname" + given-name tokens; current member of the chamber, then retired, then other chamber. */
function person(chamber, surname, givenTokens) {
  const k = norm(surname), g = givenTokens.map(norm).filter(Boolean);
  const fits = cands.filter((c) => c.names.has(k));
  for (const stage of [fits.filter((c) => c.chamber === chamber), fits.filter((c) => !c.chamber), fits.filter((c) => c.chamber && c.chamber !== chamber)]) {
    let ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length > 1) ids = [...new Set(stage.filter((c) => g.some((t) => [...c.given].some((u) => u === t || u.slice(0, 3) === t.slice(0, 3) && t.length > 2 && u.length > 2))).map((c) => c.id))]; // shared surname: the given name decides
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { ambiguous.add(`${chamber}:${surname}, ${givenTokens.join(" ")}`); return null; }
  }
  return null;
}

/**
 * Split a run of "Last, First M., Jr. Last, First" text into [{surname, given[]}]. A token ending in a comma starts
 * the given name unless a suffix (Jr., III, Ph.D.) follows it; surnames are one token ("Cobb-Hunter").
 */
function splitNames(text) {
  const t = text.replace(/,,/g, ",").split(/\s+/).filter(Boolean);
  const ends = [];
  for (let i = 0; i < t.length; i++) if (t[i].endsWith(",") && !SUFFIX.test(t[i + 1] ?? "")) ends.push(i);
  return ends.map((s, n) => ({ surname: t[s].slice(0, -1), given: t.slice(s + 1, n + 1 < ends.length ? ends[n + 1] : t.length) }));
}

// --- Vote lists
const lists = {};
for (const ch of ["H", "S"]) {
  const file = join(work, `list-${ch}.html`);
  if (!existsSync(file)) {
    const res = await fetch(`${SITE}/votehistory.php`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "thefullrecord-ingest/1.0 (civic transparency)" }, body: `type=CHAMBER&session=126&chamber=${ch}&headerfooter=1`, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`vote list ${ch} -> ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const html = readFileSync(file, "latin1");
  const rows = [];
  for (const [tr] of html.matchAll(/<tr style="background-color:#ffffff;"[\s\S]*?<\/tr>/g)) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (tds.length !== 13) continue; // 9-cell rows are officer elections
    const key = /KEY=(\d+)/.exec(tds[0])?.[1];
    const bill = cell(tds[1]);
    const dm = /(\d\d)\/(\d\d)\/(\d{4})/.exec(cell(tds[3]));
    if (!key || !/^[HS] \d+/.test(bill) || !dm) continue;
    const [first, ...motion] = cell(tds[2]).split(" | ");
    const num = (i) => Number(cell(tds[i]) || 0);
    rows.push({ key, ch, bill, title: first.replace(/^\(|\)$/g, ""), hadTitle: first.startsWith("("), motion: motion.join(" ").trim(), date: `${dm[3]}-${dm[1]}-${dm[2]}`, yea: num(5), nay: num(6), result: cell(tds[12]) });
  }
  lists[ch] = rows.filter((r) => r.yea + r.nay > 0);
  console.log(`${ch}: ${rows.length} bill votes, ${lists[ch].length} with yeas or nays`);
}

// --- Fetch PDFs (cached)
const todo = Object.values(lists).flat();
let n = 0;
for (const r of todo) {
  const file = join(work, `v-${r.key}.pdf`);
  if (!existsSync(file)) writeFileSync(file, Buffer.from(await (await politeGet(`${SITE}/votehistory.php?KEY=${r.key}`, { minGapMs: 350 })).arrayBuffer()));
  if (++n % 200 === 0) console.log(`${n}/${todo.length} fetched`);
}
const texts = {};
for (let i = 0; i < todo.length; i += 100) {
  const files = todo.slice(i, i + 100).map((r) => join(work, `v-${r.key}.pdf`));
  Object.assign(texts, JSON.parse(execFileSync("python3", [join(ROOT, "scripts/ingest/sc-pdf-text.py"), ...files], { env: { ...process.env, PYTHONPATH: "/tmp/claude-1000/pp" }, maxBuffer: 1 << 28 })));
}

// --- Parse
const rolls = { lower: [], upper: [] };
const dropped = {}; const drop = (why) => (dropped[why] = (dropped[why] ?? 0) + 1);
const now = new Date().toISOString();
for (const r of todo) {
  const chamber = CHAMBERS[r.ch];
  const raw = texts[join(work, `v-${r.key}.pdf`)];
  if (!raw) { drop("pdf-unreadable"); continue; }
  const body = raw.replace(/^Page \d+ of \d+$/gm, "");
  const heads = [...body.matchAll(/^(YEAS|AYES|NAYS|EXCUSED ABSENCE|NOT VOTING|PRESENT|ABSTAIN\/RECUSED|ABSTAIN|RECUSED)\s*-\s*(\d+)\s*$/gm)];
  const votes = {}; let yes = 0, no = 0, countBad = !heads.length;
  for (let i = 0; i < heads.length && !countBad; i++) {
    const pos = SECTION[heads[i][1]];
    const names = splitNames(body.slice(heads[i].index + heads[i][0].length, heads[i + 1]?.index ?? body.length));
    if (names.length !== Number(heads[i][2])) { countBad = true; break; }
    for (const { surname, given } of names) {
      if (pos === "yes") yes++; else if (pos === "no") no++;
      const id = person(chamber, surname, given);
      if (!id) { const k = `${chamber}:${surname}, ${given.join(" ")}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
      votes[id] = pos;
    }
  }
  if (countBad) { drop("name-count-mismatch"); continue; }
  if (yes !== r.yea || no !== r.nay) { drop("tally-mismatch"); continue; }
  // Outcome is the official result printed on the roll call ("RESULT: Passed|Failed"; the vote list's Result column is
  // the backup), not yea > nay: suspending a Senate rule, granting free-conference powers or concurring in some House
  // amendments need a supermajority, and the Senate/House Journals confirm those "Failed" results.
  // Known misprints: on some House tabling/amendment votes the PDF's RESULT is the opposite of the House Journal.
  //  - "Passed" with no more yeas than nays cannot be right (every motion needs at least a majority of those voting):
  //    the Journal shows each such vote lost (KEY 25570, 26222, 28105, 28127), so it is stored Failed.
  //  - JOURNAL_RESULT lists the "Failed" misprints the House Journal contradicts.
  const printed = /^RESULT:\s*(.+?)\s*$/m.exec(body)?.[1] || r.result;
  if (r.result && printed !== r.result) console.warn(`${r.key}: PDF result ${printed} != list result ${r.result}`);
  let passed = JOURNAL_RESULT[r.key] ?? (/^Passed$/i.test(printed) ? true : /^Failed$/i.test(printed) ? false : null);
  if (passed === null) { drop(`no-official-result(${printed || "none"})`); continue; }
  if (passed && yes <= no) { console.warn(`${r.key}: printed ${printed} ${yes}-${no}; stored Failed`); passed = false; }
  if (!passed && yes > no && !(r.key in JOURNAL_RESULT)) console.warn(`${r.key}: ${r.ch} "${r.motion}" printed ${printed} ${yes}-${no} (supermajority?)`);
  rolls[chamber].push({
    id: `sc-${r.ch.toLowerCase()}-${r.key}`,
    bill: r.bill,
    title: r.hadTitle ? r.title : r.motion || r.title,
    ...(r.motion ? { question: r.motion } : {}),
    kind: classify({ motion_text: `${r.motion} ${r.title}`, motion_classification: /passage|third reading|concur|adopt|conference report/i.test(r.motion) ? ["passage"] : [] }),
    outcome: `${passed ? "Passed" : "Failed"} ${r.yea}–${r.nay}`,
    date: r.date,
    dateLabel: `${MONTHS[Number(r.date.slice(5, 7)) - 1]} ${Number(r.date.slice(8, 10))}, ${r.date.slice(0, 4)}`,
    sourceUrl: `${SITE}/votehistory.php?KEY=${r.key}`,
    votes,
  });
}

console.log("dropped:", dropped, "unmatched:", Object.fromEntries([...unmatched].slice(0, 40)));
for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-sc-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("sc", chamber),
    sourceLabel: `Roll call · South Carolina ${chamber === "lower" ? "House" : "Senate"} floor votes (SC Legislature)`,
    keyBy: "openstates",
    jurisdiction: "sc",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.at(-1)?.date}..${list[0]?.date}`);
}
console.log("dropped:", dropped);
console.log("ambiguous:", [...ambiguous]);
console.log("unmatched:", Object.fromEntries(unmatched));
