/**
 * Massachusetts 194th General Court (2025-26) House and Senate floor roll calls from the Legislature's own open data.
 * Replaces any sampled Open States files state-ma-{lower,upper}.json.
 *
 * Sources (plain GETs, keyless public API documented at https://malegislature.gov/api, <= 2.5 requests/second):
 *   https://malegislature.gov/api/GeneralCourts/194/Branches/Senate/RollCalls[/n]   Senate: question + member codes per position
 *   https://malegislature.gov/api/GeneralCourts/194/LegislativeMembers/<code>       member name
 *   https://malegislature.gov/Journal/House/194/{2025,2026}/RollCalls                House: one PDF of every yea-and-nay sheet
 *   https://malegislature.gov/RollCall/194/SenateRollCall<n>.pdf                     Senate sheet header gives the bill number
 *   https://malegislature.gov/api/GeneralCourts/194/Documents[/<bill>/DocumentHistoryActions]   bill titles; dates and
 *       adopted/rejected wording of Senate votes ("see Roll Call #n"), House cross-check ("See YEA and NAY No. n")
 * The House API has no roll-call endpoint, so the House PDF (4 columns of "SurnameY/N/X/P") is parsed; a roll call whose
 * parsed yes/no counts differ from the printed tally is dropped. Senate roll calls whose bill/date cannot be established
 * (e.g. the Senate President election) are dropped. Not voting/absent -> "absent". Massachusetts publishes no per-vote
 * summary, so none is stored. Members are keyed "ocd-person/<uuid>" via the Open States MA people CSV plus its retired list.
 *
 * Needs pypdf: pip install pypdf. Cache: --work (default ~/.cache/ma-leg).
 * Run: node scripts/ingest/ma-leg.mjs [--work dir]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const SITE = "https://malegislature.gov";
const API = `${SITE}/api/GeneralCourts/194`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/ma-leg");
mkdirSync(join(work, "sen"), { recursive: true });

async function cached(url, name, binary = false) {
  const file = join(work, name);
  if (existsSync(file)) return readFileSync(file, binary ? undefined : "utf8");
  const res = await politeGet(url, { minGapMs: 400 });
  const data = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
  writeFileSync(file, data);
  return data;
}
const json = async (url, name) => JSON.parse(await cached(url, name));
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
const cands = []; // { id, given, names, chamber (current members only) }
const add = (id, given, family, chamber) => cands.push({ id, given: norm(given), full: norm(family), names: new Set([norm(family), norm(family.split(/[ -]/).at(-1))]), chamber });
for (const p of csv(await cached("https://data.openstates.org/people/current/ma.csv", "ma.csv"))) add(p.id, p.given_name, p.family_name, p.current_chamber);
try {
  const listing = JSON.parse(await cached("https://api.github.com/repos/openstates/people/contents/data/ma/retired", "retired.json"));
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    add(`ocd-person/${m[2]}`, given, rest.join(" "), null);
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const unmatched = new Map(), ambiguous = new Map();
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
/** Open States id for a surname (+ first initial / given name); null (and counted) when unknown or ambiguous. */
function person(chamber, surname, initial, label, given) {
  const k = norm(surname), i = norm(initial ?? "")[0], g = given ? norm(given) : null;
  const bySurname = cands.filter((c) => c.names.has(k));
  for (let stage of [bySurname.filter((c) => c.chamber === chamber), bySurname.filter((c) => !c.chamber), bySurname.filter((c) => c.chamber && c.chamber !== chamber)]) {
    stage = stage.filter((c) => (g ? c.given === g || g.startsWith(c.given) || c.given.startsWith(g) : i ? c.given[0] === i : true));
    let ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length > 1) ids = [...new Set(stage.filter((c) => c.full === k).map((c) => c.id))].length === 1 ? [...new Set(stage.filter((c) => c.full === k).map((c) => c.id))] : ids;
    if (ids.length > 1 && g) ids = [...new Set(stage.filter((c) => c.given === g || g.startsWith(c.given) || c.given.startsWith(g)).map((c) => c.id))];
    if (ids.length > 1 && i) ids = [...new Set(stage.filter((c) => c.given[0] === i).map((c) => c.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { bump(ambiguous, label); return null; }
  }
  return null;
}

// --- Bill titles.
const titles = new Map();
for (const d of JSON.parse(await cached(`${API}/Documents`, "docs.json"))) if (d.BillNumber) titles.set(d.BillNumber, d.Title);

// --- Senate: roll-call list, each roll call, each sheet's header.
const list = await json(`${API}/Branches/Senate/RollCalls`, "senate-list.json");
const senate = new Map(); // n -> { q, yeas[], nays[], absent[], bill, printed }
for (const { RollCallNumber: n } of list) {
  const r = await json(`${API}/Branches/Senate/RollCalls/${n}`, `sen/${n}.json`);
  const codes = (a) => (a ?? []).map((x) => x.MemberCode);
  senate.set(n, { q: r.QuestionMotion, yeas: codes(r.Yeas), nays: codes(r.Nays), absent: codes(r.Absent) });
  await cached(`${SITE}/RollCall/194/SenateRollCall${n}.pdf`, `sen/${n}.pdf`, true);
}
const pyPdf = (files) => {
  for (let i = 0; i < files.length; i += 100) execFileSync("python3", [join(ROOT, "scripts/ingest/pdf-batch.py"), "plain", ...files.slice(i, i + 100)], { stdio: "inherit" });
};
pyPdf([...senate.keys()].filter((n) => !existsSync(join(work, `sen/${n}.txt`))).map((n) => join(work, `sen/${n}.pdf`)));
for (const [n, s] of senate) {
  const t = readFileSync(join(work, `sen/${n}.txt`), "utf8");
  const h = /Roll Call #(\d+)\s*\n\s*(?:([A-Z]{1,2}\.?\s?\d+)\s*)?--\s*([^\n]*)/.exec(t);
  s.bill = h && Number(h[1]) === n ? h[2]?.replace(/[.\s]/g, "") : undefined;
  s.sheetQuestion = h?.[3]?.trim();
  s.printed = [...t.matchAll(/[−–-]\s*(\d+)\.\s*(?:\n|$)/g)].map((m) => Number(m[1]));
}

// --- House: the two yearly PDFs.
let houseText = "";
for (const y of [2025, 2026]) {
  await cached(`${SITE}/Journal/House/194/${y}/RollCalls`, `house-${y}.pdf`, true);
  if (!existsSync(join(work, `house-${y}.txt`))) pyPdf([join(work, `house-${y}.pdf`)]);
  houseText += readFileSync(join(work, `house-${y}.txt`), "utf8") + "\n";
}
const house = new Map(); // n -> { bill, motion, date, yes, no, members: [[name, code]] }
for (const block of houseText.split("MASSACHUSETTS HOUSE OF REPRESENTATIVES").slice(1)) {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = /^([HS])\. (\d+)(.*?)Yea and Nay\s+(\d+)\/(\d+)\/(\d{4})/.exec(lines[0]);
  const tally = /^No\. (\d+) (\d+) YEAS (\d+) NAYS (\d+) N\/V/.exec(lines[1] ?? "");
  if (!head || !tally) { bump(unmatched, "house-unparsed-header"); continue; }
  const end = lines.findIndex((l) => l.startsWith("*=AFTER VOTE"));
  const members = [];
  for (const line of lines.slice(2, end < 0 ? undefined : end)) {
    // an entry is "<name><Y|N|X|P>": the position letter follows a lowercase letter, '.', '*', quote or '-' and ends the token
    for (const m of line.matchAll(/(.+?[a-z.*'’\-]) ?([YNXP])(?=\s|$)/g)) members.push([m[1].trim(), m[2]]);
  }
  const n = Number(tally[1]);
  if (house.has(n)) { bump(unmatched, "house-duplicate-number"); continue; }
  const motion = head[3].replace(/^[\s,]*(?:as |chg|changed|amended)[^]*?(?=On\b)/i, "").replace(/\s+/g, " ").trim();
  house.set(n, { bill: `${head[1]}${head[2]}`, motion, date: `${head[6]}-${head[4].padStart(2, "0")}-${head[5].padStart(2, "0")}`, yes: +tally[2], no: +tally[3], members });
}

// --- History actions for every bill with a roll call.
const bills = new Set([...senate.values()].map((s) => s.bill).concat([...house.values()].map((h) => h.bill)).filter(Boolean));
const actions = { House: new Map(), Senate: new Map() }; // roll number -> { date, text }
for (const bill of bills) {
  let hist;
  try { hist = await json(`${API}/Documents/${bill}/DocumentHistoryActions`, `hist-${bill}.json`); } catch (e) { console.warn(`history ${bill}: ${e.message}`); continue; }
  for (const a of hist) {
    const text = a.Action.replace(/\s+/g, " ");
    const hm = /YEA and NAY No\.\s*(\d+)/i.exec(text), sm = /Roll Call\s*#\s*(\d+)/i.exec(text);
    if (hm && a.Branch === "House") actions.House.set(Number(hm[1]), { date: a.Date.slice(0, 10), text });
    if (sm && a.Branch === "Senate") actions.Senate.set(Number(sm[1]), { date: a.Date.slice(0, 10), text });
  }
}

// --- Senators by member code.
const senators = new Map(); // code -> id
for (const code of new Set([...senate.values()].flatMap((s) => [...s.yeas, ...s.nays, ...s.absent]))) {
  const m = await json(`${API}/LegislativeMembers/${encodeURIComponent(code)}`, `sen/mem-${norm(code)}-${code.length}.json`);
  const name = m.Name.replace(/,?\s+(Jr|Sr|II|III)\.?$/i, "");
  const parts = name.split(/\s+/), given = parts[0];
  senators.set(code, person("upper", parts.at(-1), given[0], `upper:${m.Name}`, given) ?? person("upper", parts.at(-1), undefined, `upper:${m.Name}`));
}

{ const seen = new Map(); for (const [c, id] of senators) { if (!id || seen.has(id)) throw new Error(`senator ${c} unmapped or duplicate of ${seen.get(id)}`); seen.set(id, c); } }
const verdict = (text, yes, no) => (/reject|fail|lost|defeat|not agreed|negativ/i.test(text ?? "") ? "Failed" : /adopt|pass|enact|engross|accept|agree|concur|approv|confirm|prevail|sustain|ordered/i.test(text ?? "") ? "Passed" : yes > no ? "Passed" : "Failed");
const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const dropped = {}; const droppedIds = {};
const drop = (why, id) => { dropped[why] = (dropped[why] ?? 0) + 1; (droppedIds[why] ??= []).push(id); };
const label = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
const kindOf = (q, passage) => (/\bchair\b|quorum/i.test(q) ? "procedural" : classify({ motion_text: q, motion_classification: passage ? ["passage"] : [] }));
const POS = { Y: "yes", N: "no", X: "absent", P: "present" };
const count = (votes, v) => Object.values(votes).filter((x) => x === v).length;

for (const [n, h] of house) {
  const votes = {}; let bad = 0;
  for (const [raw, c] of h.members) {
    const name = raw.replace(/\s*\*$/, "").replace(/^-+|-+$/g, "").trim();
    let pid;
    if (name === "Mr. Speaker") pid = person("lower", "Mariano", "R", "lower:Mr. Speaker");
    else { const m = /^(.+?)(?:,\s*|\s+)([A-Z])\.$/.exec(name); pid = person("lower", m ? m[1] : name, m?.[2], `lower:${name}`); }
    if (!pid) { bump(unmatched, `lower:${name}`); bad++; continue; }
    votes[pid] = POS[c];
  }
  const yes = count(votes, "yes"), no = count(votes, "no");
  if (yes !== h.yes || no !== h.no || h.members.filter(([, c]) => c === "Y").length !== h.yes || h.members.filter(([, c]) => c === "N").length !== h.no) { drop("house-tally-mismatch", `${n} parsed ${yes}-${no} printed ${h.yes}-${h.no} (${bad} unmatched)`); continue; }
  const act = actions.House.get(n);
  if (act && act.date !== h.date) console.warn(`house #${n}: PDF date ${h.date} vs history ${act.date}`);
  rolls.lower.push({
    id: `ma-h${n}`, bill: h.bill, title: titles.get(h.bill) ?? h.bill, question: h.motion || undefined,
    kind: kindOf(h.motion, /engross|enact|conference report|acceptance|passing/i.test(h.motion)),
    outcome: `${verdict(act?.text, yes, no)} ${yes}–${no}`, date: h.date, dateLabel: label(h.date),
    sourceUrl: `${SITE}/RollCall/194/HouseRollCall${n}.pdf`, votes,
  });
}

for (const [n, s] of senate) {
  const id = `s${n}`;
  // A few sheets are not linked from the bill history; the date is taken from the neighbouring roll calls only when both agree.
  const near = (d) => { for (let k = n + d; k > 0 && k <= list.length; k += d) if (actions.Senate.has(k)) return actions.Senate.get(k).date; };
  const act = actions.Senate.get(n) ?? (near(-1) && near(-1) === near(1) ? { date: near(-1), text: "" } : undefined);
  if (!s.yeas.length && !s.nays.length) { drop("senate-no-recorded-votes", id); continue; }
  if (!s.bill || !act) { drop("senate-no-bill-or-date", id); continue; }
  const votes = {}; let bad = 0;
  for (const [codes, pos] of [[s.yeas, "yes"], [s.nays, "no"], [s.absent, "absent"]]) for (const code of codes) {
    const pid = senators.get(code);
    if (!pid) { bump(unmatched, `upper:${code}`); bad++; continue; }
    votes[pid] = pos;
  }
  const yes = count(votes, "yes"), no = count(votes, "no");
  const [py, pn] = s.printed.length >= 2 ? s.printed : [];
  if (yes !== s.yeas.length || no !== s.nays.length || (py != null && (py !== s.yeas.length || pn !== s.nays.length))) { drop("senate-tally-mismatch", `${n} parsed ${yes}-${no} api ${s.yeas.length}-${s.nays.length} printed ${s.printed} (${bad} unmatched)`); continue; }
  rolls.upper.push({
    id: `ma-${id}`, bill: s.bill, title: titles.get(s.bill) ?? s.bill, question: s.q ?? s.sheetQuestion,
    kind: kindOf(s.q ?? "", /engross|enact|passage|acceptance/i.test(s.q ?? "")),
    outcome: `${verdict(act.text, yes, no)} ${yes}–${no}`, date: act.date, dateLabel: label(act.date),
    sourceUrl: `${SITE}/RollCall/194/SenateRollCall${n}.pdf`, votes,
  });
}

for (const chamber of ["lower", "upper"]) {
  const l = rolls[chamber];
  l.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id, "en", { numeric: true }));
  await writeSnapshot(join(OUT, `state-ma-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("ma", chamber),
    sourceLabel: `Roll call · Massachusetts ${chamber === "lower" ? "House" : "Senate"} floor votes (Massachusetts Legislature)`,
    keyBy: "openstates", jurisdiction: "ma", legislativeChamber: chamber, rollCalls: l,
  }, { compact: true });
  console.log(`${chamber}: ${l.length} roll calls, ${l.at(-1)?.date} to ${l[0]?.date}`);
}
console.log("dropped:", dropped);
console.log("dropped ids:", JSON.stringify(droppedIds));
console.log("ambiguous:", Object.fromEntries(ambiguous));
console.log("unmatched members:", Object.fromEntries(unmatched));
