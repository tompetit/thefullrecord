/**
 * Texas 89th Legislature (2025 regular session, 1st and 2nd called sessions) floor votes from the House and Senate
 * daily journals. Replaces any sampled Open States files state-tx-{lower,upper}.json with every recorded House and Senate
 * floor vote on a bill or resolution: passage (to engrossment / third reading / final), amendments, motions to table,
 * concurrence in the other chamber's amendments, conference committee reports and resolution adoptions.
 * Not imported: Senate motions to suspend the rules / take up out of order (hundreds of near-unanimous routine
 * 4/5 votes), nominations confirmations, quorum calls, votes with no bill attached, and Senate "deemed to have voted Yea"
 * voice votes (no individual positions are recorded). There was no 2026 session (the 90th Legislature meets in 2027).
 *
 * Sources (plain GETs of public files; the journals ARE the official record of every recorded vote):
 *   https://salsajournalwebservices.legis.texas.gov/api/v1/JournalWebSite/journals-for-legislature/89/{H|S}
 *       the public JSON index (no key, no login) that the two journal sites themselves use: one entry per legislative day
 *   https://journals.house.texas.gov/HJRNL/{89R|891|892}/HTML/<day>.HTM   House Journal, "(Record N): Y Yeas, N Nays, N Present, not voting"
 *       followed by the full "Yeas — ... / Nays — ... / Present, not voting — ... / Absent, Excused — ... / Absent — ..." lists
 *   https://journals.senate.texas.gov/SJRNL/{89R|89S1|89S2}/HTML/<day>.HTM   Senate Journal, "by the following vote: Yeas N, Nays N."
 *       followed by "Yeas: ... / Nays: ... / Present-not voting: ... / Absent-excused: ... / Absent: ..." (the Yeas list is
 *       omitted when everyone present voted yea; then yea = members in office that day minus the listed others)
 * Member surnames (with the first initial the journals add where two members share a surname) are matched to Open States
 * people (github.com/openstates/people data/tx, current + retired, role dates and alternate names) by chamber and the vote
 * date. Every stored tally must equal the printed count of every list; otherwise the roll call is dropped and counted.
 * A name that fits no one or several people drops the roll call (no partial voter lists).
 * Titles are the caption of the version voted: for a passage, concurrence or conference-report vote the caption of the
 * engrossed (E) or enrolled (F) bill text on Texas Legislature Online, otherwise the caption the journals printed most
 * recently before the vote ("A bill to be entitled An Act relating to ..."), never the introduced one. Texas publishes
 * no separate vote-level summaries, so no `summary` is set.
 *
 * Cache: --work (default ~/.cache/tx-leg). <= 2.5 requests/second.
 * Run: node scripts/ingest/tx-leg.mjs [--work dir] [--dry]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const OUT_DIR = args.includes("--out") ? args[args.indexOf("--out") + 1] : OUT; // write the snapshots elsewhere (to compare)
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/tx-leg");
for (const d of ["hj", "sj"]) mkdirSync(join(work, d), { recursive: true });
const gap = { minGapMs: 400 };
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

// ---------------------------------------------------------------- download journals
const API = "https://salsajournalwebservices.legis.texas.gov/api/v1/JournalWebSite/journals-for-legislature/89";
const days = []; // { chamber, session, date, name, file, url }
for (const [chamber, letter, host] of [["lower", "H", "journals.house.texas.gov"], ["upper", "S", "journals.senate.texas.gov"]]) {
  const listFile = join(work, `list-${letter}.json`);
  if (!existsSync(listFile)) writeFileSync(listFile, await (await politeGet(`${API}/${letter}`, gap)).text());
  for (const session of JSON.parse(readFileSync(listFile, "utf8")))
    for (const date of session.legislativeDates)
      for (const day of date.legislativeDays) {
        const file = join(work, chamber === "lower" ? "hj" : "sj", `${day.fileName}.htm`);
        const url = `https://${host}${day.htmlPath}`;
        if (!existsSync(file)) writeFileSync(file, await (await politeGet(url, gap)).text());
        days.push({ chamber, session: session.session, date: date.legislativeDate, name: day.fileName, file, url });
      }
}
console.log(`${days.filter((d) => d.chamber === "lower").length} House journals, ${days.filter((d) => d.chamber === "upper").length} Senate journals`);

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Journal HTML -> one text line per paragraph (non-breaking spaces become spaces). */
function textLines(html) {
  return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ENT[n])
    .replace(/ /g, " ")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// ---------------------------------------------------------------- roster (Open States people: data/tx current + retired)
const peopleDir = join(work, "osp");
if (!existsSync(join(peopleDir, "data/tx/legislature"))) {
  if (!existsSync(peopleDir)) execFileSync("git", ["clone", "-q", "--depth", "1", "--filter=blob:none", "--sparse", "https://github.com/openstates/people.git", peopleDir]);
  execFileSync("git", ["-C", peopleDir, "sparse-checkout", "set", "data/tx"]);
}
// YAML double-quoted scalars carry \xF1 / \u00F1 escapes ("Mu\xF1oz")
const unq = (s) => s?.replace(/^['"]|['"]$/g, "").replace(/\\x([\dA-F]{2})|\\u([\dA-F]{4})/gi, (_, a, b) => String.fromCharCode(parseInt(a ?? b, 16)));
/** { id, tiers:[Set(exact surname spellings), Set(looser spellings)], initials:Set, roles:[{type,district,start,end}] } */
const roster = [];
for (const dir of ["legislature", "retired"]) {
  for (const f of readdirSync(join(peopleDir, "data/tx", dir)).filter((x) => x.endsWith(".yml"))) {
    const y = readFileSync(join(peopleDir, "data/tx", dir, f), "utf8");
    const id = /^id: (\S+)/m.exec(y)?.[1];
    const family = unq(/^family_name: (.+)$/m.exec(y)?.[1] ?? "");
    const given = unq(/^given_name: (.+)$/m.exec(y)?.[1] ?? "");
    const rolesText = /^roles:\n([\s\S]*?)(?=^(?!- |  )\S)/m.exec(y)?.[1] ?? "";
    const roles = rolesText.split(/^- /m).filter(Boolean).map((r) => ({
      type: /type: (\w+)/.exec(r)?.[1], district: unq(/district: (\S+)/.exec(r)?.[1]),
      start: /start_date: '?([\d-]+)/.exec(r)?.[1] ?? "0000", end: /end_date: '?([\d-]+)/.exec(r)?.[1] ?? "9999",
    })).filter((r) => (r.type === "lower" || r.type === "upper") && r.end >= "2024-12-01");
    if (!id || !roles.length) continue;
    const others = [...y.matchAll(/^- name: (.+)$/gm)].map((m) => unq(m[1])).filter((n) => !/^(Republican|Democratic|Independent)/.test(n));
    const initials = new Set([norm(given)[0], /^email: (\w)/m.exec(y)?.[1]?.toLowerCase()]); // Chuy Hinojosa signs as "J. Hinojosa" (Juan)
    for (const n of others) { const m = /,\s*([A-Z])\.?$/.exec(n) ?? /^([A-Z])\.\s/.exec(n); if (m) initials.add(m[1].toLowerCase()); }
    const parts = family.split(/[\s-]+/);
    const tier1 = new Set([norm(family), ...others.filter((n) => !/,|\./.test(n) && n.split(" ").length <= 3).map((n) => norm(n.split(" ").slice(-2).join(" ")))]);
    for (const n of others) if (!/,/.test(n) && /^[A-Z]\./.test(n)) tier1.add(norm(n.replace(/^[A-Z][A-Za-z.]*\s+/, "")));
    roster.push({ id, current: dir === "legislature", tiers: [tier1, new Set([norm(parts.at(-1)), norm(parts[0])])], initials, roles });
  }
}
console.log(`${roster.length} legislators with a 2025+ role`);

const unmatched = new Map(), ambiguous = new Map();
/** Open States id for a journal name ("Bell, C." / "A. Hinojosa" / "Mr. Speaker(C)"), or null/"ambiguous". */
function person(chamber, raw, date) {
  const label = raw.replace(/\(C\)/, "").trim();
  if (/^Mr\.? ?Speaker/i.test(label)) return person("lower", "Burrows", date);
  let m, name = label, initial = null;
  if ((m = /^(.*\S)\s*,\s*([A-Z])\.?$/.exec(label))) { name = m[1]; initial = m[2].toLowerCase(); }
  else if ((m = /^([A-Z])\.\s*(.+)$/.exec(label))) { name = m[2]; initial = m[1].toLowerCase(); }
  const key = norm(name);
  for (const loose of [false, true]) {
    for (const tier of [0, 1]) {
      const c = roster.filter((p) => p.tiers[tier].has(key) && (!initial || p.initials.has(initial))
        && p.roles.some((r) => r.type === chamber && (loose || (r.start <= date && date <= r.end))));
      const ids = [...new Set(c.map((p) => p.id))];
      if (ids.length === 1) return ids[0];
      if (ids.length > 1) return "ambiguous";
    }
  }
  return null;
}
const activeIn = (chamber, date) => roster.filter((p) => p.roles.some((r) => r.type === chamber && r.start <= date && date <= r.end)).map((p) => p.id);

// ---------------------------------------------------------------- parse
const BILL_RE = /\b(?:CS|CC)?(HB|SB|HJR|SJR|HCR|SCR|HR|SR) (\d+)\b/;
const HEAD_H = /^(?:CS|CC)?(HB|SB|HJR|SJR|HCR|SCR|HR|SR) (\d+)\s*(?:ON |- |\()/;
const KIND = { "SENATE BILL": "SB", "HOUSE BILL": "HB", "SENATE JOINT RESOLUTION": "SJR", "HOUSE JOINT RESOLUTION": "HJR", "SENATE CONCURRENT RESOLUTION": "SCR", "HOUSE CONCURRENT RESOLUTION": "HCR", "SENATE RESOLUTION": "SR", "HOUSE RESOLUTION": "HR" };
const HEAD_S = /^((?:SENATE|HOUSE)(?: JOINT| CONCURRENT)? (?:BILL|RESOLUTION)) (\d+)\b/;
const failed = (s) => /failed|was lost|not granted|did not prevail|was defeated|not adopted/i.test(s);
const rolls = { lower: [], upper: [] };
const drops = {}; const drop = (why, extra) => { drops[why] = (drops[why] ?? 0) + 1; if (DRY && extra) console.log("DROP", why, extra); };
// Every caption the journals print for a bill, with where it was printed: a roll call takes the caption printed most recently
// before it (the version being voted on), not the first one seen (the introduced caption, often replaced by a committee
// substitute or floor amendment before the vote). Keyed by session: bill numbers restart in each called session.
const titles = new Map(); // key -> [{ date, chamber, ord, t }]
const ord = { lower: 0, upper: 0 }; // running line number through each chamber's journals, in date order
let at = null; // { date, chamber } of the journal line being read
const clean = (t) => t.replace(/\s+/g, " ").trim().replace(/\.$/, "").replace(/^[Aa]n? (?:joint |concurrent )?resolution (?=[a-z])/, "");
const setTitle = (sess, bill, t) => {
  if (!t || /^(?:CS)?(?:HB|SB|HJR|SJR|HCR|SCR|HR|SR) \d/.test(t)) return; // a list of bills ("SB 1, SB 1555"), not a caption
  const k = `${sess}:${bill}`;
  if (!titles.has(k)) titles.set(k, []);
  titles.get(k).push({ ...at, ord: ord[at.chamber], t: clean(t) });
};
/** Caption of the bill as of a roll call: the last one printed before the vote in the same chamber's journal (same day
 *  allowed) or on an earlier day in either journal; else the first one printed after it; else null. */
function titleAt(sess, bill, r) {
  const list = titles.get(`${sess}:${bill}`) ?? [];
  const before = list.filter((c) => c.date < r.date || (c.chamber === r.chamber && c.ord <= r.ord));
  const pick = (a, b) => (a.date !== b.date ? (a.date > b.date ? a : b) : a.chamber === r.chamber && b.chamber !== r.chamber ? a
    : b.chamber === r.chamber && a.chamber !== r.chamber ? b : a.ord >= b.ord ? a : b);
  if (before.length) return before.reduce(pick).t;
  const after = list.filter((c) => !before.includes(c)).sort((a, b) => a.date.localeCompare(b.date) || a.ord - b.ord);
  return after[0]?.t ?? null;
}
const seen = { lower: 0, upper: 0 };

function resolveAll(chamber, lists, date, what) {
  const votes = {};
  for (const [slot, names] of Object.entries(lists)) {
    for (const n of names) {
      const id = person(chamber, n, date);
      if (id === "ambiguous") { ambiguous.set(`${chamber}:${n}`, (ambiguous.get(`${chamber}:${n}`) ?? 0) + 1); return null; }
      if (!id) { unmatched.set(`${chamber}:${n}`, (unmatched.get(`${chamber}:${n}`) ?? 0) + 1); return null; }
      if (votes[id]) return null;
      votes[id] = slot;
    }
  }
  return votes;
}
const splitNames = (s, sep) => s.replace(/\.$/, "").split(sep).map((x) => x.trim()).filter(Boolean);

for (const d of days.filter((x) => x.chamber === "lower")) {
  const lines = textLines(readFileSync(d.file, "utf8"));
  let bill = null, amendment = null, offeror = null, seq = 0;
  const amendBy = new Map();
  at = { date: d.date, chamber: "lower" };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    ord.lower++;
    let m;
    if ((m = HEAD_H.exec(line))) bill = `${m[1]} ${m[2]}`;
    if ((m = /^Amendment No\. (\d+)$/.exec(line))) { amendment = m[1]; offeror = null; }
    if (amendment && (m = /^Representatives? (.+?) offered the following (?:substitute |floor )?amendment/.exec(line))) { offeror = m[1]; amendBy.set(`${bill}:${amendment}`, m[1]); }
    if ((m = /^(?:CS)?(HB|SB|HJR|SJR|HCR|SCR) (\d+), (?:A |An )(?:bill|joint resolution|concurrent resolution|resolution|Act) to be entitled An Act (relating to .+)$/i.exec(line))) setTitle(d.session, `${m[1]} ${m[2]}`, m[3]);
    if ((m = /^(?:CS)?(HJR|HCR|HR|SJR|SCR|SR) (\d+), (?!(?:CS)?(?:HB|SB|HJR|SJR|HCR|SCR|HR|SR) \d)([A-Z].{12,})$/.exec(line)) && !/ was /.test(line)) setTitle(d.session, `${m[1]} ${m[2]}`, m[3]);
    if ((m = /^(?:CS)?(HJR|HCR|HR|SJR|SCR|SR|HB|SB) (\d+) \(By [^)]*\), (.+)$/.exec(line))) setTitle(d.session, `${m[1]} ${m[2]}`, m[3]);
    const v = /\(Record (\d+)\):\s+(\d+) Yeas, (\d+) Nays, (\d+) Present, not voting/.exec(line);
    if (!v) continue;
    seen.lower++;
    // lists
    const lists = { yes: [], no: [], present: [], absent: [] }; let j = i + 1; const SEP = /\s*;\s*/;
    for (; j < lines.length; j++) {
      const l = /^(Yeas|Nays|Present, not voting|Absent, Excused|Absent) — (.*)$/.exec(lines[j]);
      if (!l) break;
      lists[{ Yeas: "yes", Nays: "no", "Present, not voting": "present" }[l[1]] ?? "absent"].push(...splitNames(l[2], SEP));
    }
    const counts = { yes: +v[2], no: +v[3], present: +v[4] };
    const bad = Object.entries(counts).find(([k, n]) => lists[k].length !== n);
    if (bad) { drop(`tally-mismatch(${bad[0]})`, `${d.name} rec ${v[1]}: ${lists[bad[0]].length} vs ${bad[1]}`); continue; }
    const verified = /verified vote/.test(line);
    let lead = line.slice(0, v.index).replace(/\s+by\s*$/, "").replace(/,? as follows\s*$/, "").trim();
    if (verified) {
      // After a verification the chair restates the result: "The chair stated that HB 1 passed by the above vote."
      lead = lines.slice(j, j + 3).find((l) => /^The chair stated that .* by the above vote/.test(l))?.replace(/^The chair stated that /, "").replace(/ by the above vote.*$/, "") ?? "";
      if (!lead) for (let k = i - 1; k >= Math.max(0, i - 8); k--) if (/^The vote of the house was taken on/.test(lines[k])) { lead = lines[k].replace(/^The vote of the house was taken on /, "").replace(/ and the vote was announced.*$/, ""); break; }
    }
    // question
    const named = BILL_RE.exec(lead);
    let question, passage = false, theBill = named ? `${named[1]} ${named[2]}` : bill;
    const amd = /Amendment No\. (\d+)/.exec(lead);
    const by = (n) => { const o = amendBy.get(`${theBill}:${n}`); return o ? ` (${o})` : ""; };
    if (/motion to table/i.test(lead)) question = amd ? `Table Amendment No. ${amd[1]}${by(amd[1])}` : `Table Amendment No. ${amendment ?? "?"}${amendment ? by(amendment) : ""}`;
    else if (/concur in the senate amendments/i.test(lead)) { question = "Concur in Senate amendments"; passage = true; }
    else if (/conference committee report/i.test(lead)) { question = "Adopt conference committee report"; passage = true; }
    else if (!amd && /engrossment/i.test(lead)) { question = "Passage to engrossment (second reading)"; passage = true; }
    else if (!amd && /pass(?:ed)? to third reading/i.test(lead)) { question = "Passage to third reading (second reading)"; passage = true; }
    else if (!amd && (/\b(?:was|be) passed\b|final passage|passed by|\bpassed\b|to pass\b/i.test(lead))) { question = "Final passage (third reading)"; passage = true; }
    else if (amd) question = `Adopt Amendment No. ${amd[1]}${by(amd[1])}`;
    else if (named && /adopted|adoption/i.test(lead)) { question = `Adopt ${theBill}`; passage = true; }
    else {
      let motion = "";
      for (let k = i - 1; k >= Math.max(0, i - 6); k--) if (/\b(moved|requested|motion)\b/i.test(lines[k]) && !/^Amendment No/.test(lines[k])) { motion = lines[k]; break; }
      const ext = /Representative (.+?) requested (?:an|a second|a third) extension of speaking time/.exec(motion);
      question = ext ? `Extend speaking time for Rep. ${ext[1]}` : `Motion: ${(motion || lead).replace(/^Representative [^ ]+(?: [A-Z][a-z]+)? moved (?:that )?/i, "").slice(0, 150)}`;
    }
    if (!theBill) { drop("no-bill", `${d.name} rec ${v[1]}: ${lead.slice(0, 100)}`); continue; }
    const votes = resolveAll("lower", lists, d.date, v[1]);
    if (!votes) { drop("unmatched-or-ambiguous-member", `${d.name} rec ${v[1]}`); continue; }
    const failedFinal = lead ? failed(lead) : counts.yes <= counts.no;
    const twoThirds = failedFinal && counts.yes > counts.no && /two-thirds/.test(lead);
    rolls.lower.push({
      session: d.session,
      id: `tx-h-${d.session}-${String(v[1]).padStart(4, "0")}`,
      bill: theBill, date: d.date, chamber: "lower", ord: ord.lower, question,
      kind: /^(?:Motion:|Extend speaking)/.test(question) ? "procedural" : classify({ motion_text: question, motion_classification: passage ? ["passage"] : [] }),
      outcome: `${failedFinal ? "Failed" : "Passed"} ${counts.yes}–${counts.no}${twoThirds ? " (two-thirds needed)" : ""}`,
      dateLabel: `${MONTHS[+d.date.slice(5, 7) - 1]} ${+d.date.slice(8, 10)}, ${d.date.slice(0, 4)}`,
      sourceUrl: d.url,
      votes: Object.fromEntries(Object.entries(votes).map(([k, s]) => [k, s])),
    });
    void offeror; void seq;
  }
}

const seqs = new Map(); // two journal files can share one date (e.g. 08-27-F and 08-27-F1)
const nextSeq = (key) => { seqs.set(key, (seqs.get(key) ?? 0) + 1); return seqs.get(key); };
for (const d of days.filter((x) => x.chamber === "upper")) {
  const lines = textLines(readFileSync(d.file, "utf8"));
  const active = activeIn("upper", d.date);
  let bill = null, prev = null, seq = 0;
  at = { date: d.date, chamber: "upper" };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    ord.upper++;
    let m;
    if ((m = HEAD_S.exec(line))) bill = `${KIND[m[1]]} ${m[2]}`;
    // "Senator X moved to suspend the regular order ... to take up for consideration CSSB 39" / "moved to concur in the House amendments to SB 2"
    if (/\bmoved\b/.test(line) && !/ by the following vote/.test(line)) { const all = [...line.matchAll(new RegExp(BILL_RE, "g"))]; if (all.length) bill = `${all.at(-1)[1]} ${all.at(-1)[2]}`; }
    if ((m = /^(?:CS)?(HB|SB|HJR|SJR|HCR|SCR|HR|SR) (\d+), (Relating to .+|[A-Z].+)$/.exec(line)) && !/ was /.test(line)) setTitle(d.session, `${m[1]} ${m[2]}`, m[3]);
    const v = /^(.*?)\s*by the following vote:\s+Yeas (\d+), Nays (\d+)(?:, Present-not voting (\d+))?\.\s*(\(Same as previous roll call\))?/.exec(line);
    if (!v) continue;
    seen.upper++;
    const lists = { yes: [], no: [], present: [], absent: [] }; let j = i + 1; let gotYes = false; const SEP = /\s*,\s*/;
    for (; j < lines.length; j++) {
      const l = /^(Yeas|Nays|Present-not voting|Absent-excused|Absent):\s*(.*)$/.exec(lines[j]);
      if (!l) break;
      if (l[1] === "Yeas") gotYes = true;
      lists[{ Yeas: "yes", Nays: "no", "Present-not voting": "present" }[l[1]] ?? "absent"].push(...splitNames(l[2], SEP));
    }
    const counts = { yes: +v[2], no: +v[3], present: +(v[4] ?? 0) };
    const lead = v[1];
    let votes;
    if (v[5] && !lists.yes.length && !lists.no.length && prev && prev.counts.yes === counts.yes && prev.counts.no === counts.no && prev.counts.present === counts.present && !lists.absent.length) {
      votes = prev.votes;
    } else if (v[5] && !gotYes && !lists.no.length && prev && prev.counts.yes === counts.yes && prev.counts.no === counts.no && prev.counts.present === counts.present) {
      votes = prev.votes; // "Same as previous roll call" with only the absent line repeated
    } else {
      const given = new Set();
      const resolved = resolveAll("upper", { yes: lists.yes, no: lists.no, present: lists.present, absent: lists.absent }, d.date);
      if (!resolved) { drop("unmatched-or-ambiguous-member", `${d.name}: ${lead.slice(0, 80)}`); continue; }
      votes = resolved;
      for (const k of Object.keys(votes)) given.add(k);
      if (!gotYes) for (const id of active) if (!given.has(id)) votes[id] = "yes";
    }
    const tally = { yes: 0, no: 0, present: 0 };
    for (const s of Object.values(votes)) if (s in tally) tally[s]++;
    if (tally.yes !== counts.yes || tally.no !== counts.no || tally.present !== counts.present) { drop("tally-mismatch", `${d.name} ${bill}: got ${JSON.stringify(tally)} want ${JSON.stringify(counts)}`); continue; }
    prev = { votes, counts };
    // preceding motion sentence
    let motion = "";
    for (let k = i; k >= Math.max(0, i - 4); k--) if (/\bmoved\b/.test(lines[k]) ) { motion = lines[k]; break; }
    const context = `${motion} ${lead}`;
    const bm = BILL_RE.exec(lead) ?? BILL_RE.exec(motion);
    const theBill = bm ? `${bm[1]} ${bm[2]}` : bill;
    let question, passage = false;
    if (/Rule \d|suspend|regular order|placed on (?:its|the) (?:second|third)|take up|be placed|Constitutional Rule|three several days/i.test(motion) && /^The motion prevailed/.test(lead) && !/concur|conference/i.test(motion)) { drop("rule-suspension"); continue; }
    if (/nominee|nomination|confirmed/i.test(lead)) { drop("nominations"); continue; }
    if (/passed to engrossment/i.test(lead)) { question = "Passage to engrossment (second reading)"; passage = true; }
    else if (/passed to third reading/i.test(lead)) { question = "Passage to third reading (second reading)"; passage = true; }
    else if (/passed|finally passed/i.test(lead)) { question = "Final passage (third reading)"; passage = true; }
    else if (/amendment to/i.test(lead)) {
      let no = null, who = null; // nearest "Floor Amendment No. N" / "Senator X offered the following amendment" above the vote
      for (let k = i; k >= Math.max(0, i - 80) && !(no && who); k--) {
        no ??= /^Floor Amendment No\. (\d+)/.exec(lines[k])?.[1] ?? null;
        who ??= /^Senators? (.+?) offered the following (?:floor )?amendment/.exec(lines[k])?.[1] ?? null;
      }
      question = `Adopt Floor Amendment${no ? ` No. ${no}` : ""}${who ? ` (${who})` : ""}`;
    }
    else if (/Conference Committee Report/i.test(lead)) { question = "Adopt conference committee report"; passage = true; }
    else if (/was adopted|and was adopted|adopted/i.test(lead)) { question = `Adopt ${theBill ?? "resolution"}`; passage = true; }
    else if (/Motion In Writing/i.test(lead)) question = "Motion: conference committee motion in writing";
    else if (/concur/i.test(motion)) { question = "Concur in House amendments"; passage = true; }
    else question = `Motion: ${(motion || lead).replace(/^Senator [^ ]+(?: [A-Z][a-z]+)? moved (?:that )?/i, "").slice(0, 150)}`;
    if (!theBill) { drop("no-bill", `${d.name}: ${context.slice(0, 120)}`); continue; }
    const fail = failed(lead) || failed(motion.slice(-60)) && /failed/.test(lead);
    rolls.upper.push({
      session: d.session,
      id: `tx-s-${d.session}-${d.date.replace(/-/g, "")}-${String(nextSeq(d.session + d.date)).padStart(3, "0")}`,
      bill: theBill, date: d.date, chamber: "upper", ord: ord.upper, question,
      kind: /^Motion:/.test(question) ? "procedural" : classify({ motion_text: question, motion_classification: passage ? ["passage"] : [] }),
      outcome: `${fail ? "Failed" : "Passed"} ${counts.yes}–${counts.no}`,
      dateLabel: `${MONTHS[+d.date.slice(5, 7) - 1]} ${+d.date.slice(8, 10)}, ${d.date.slice(0, 4)}`,
      sourceUrl: d.url,
      votes,
    });
  }
}
console.log(`found ${seen.lower}/${seen.upper} vote blocks; kept ${rolls.lower.length} House, ${rolls.upper.length} Senate`);
console.log("dropped:", drops);
if (DRY) { console.log("ambiguous:", Object.fromEntries(ambiguous), "\nunmatched:", Object.fromEntries(unmatched)); process.exit(0); }

// ---------------------------------------------------------------- titles and output
// Bills whose caption the journals do not print in a recognisable place: caption from the Texas Legislature Online bill page.
mkdirSync(join(work, "tlo"), { recursive: true });
for (const chamber of ["lower", "upper"]) for (const r of rolls[chamber]) {
  const key = `${r.session}:${r.bill}`;
  if (titles.has(key)) continue;
  at = { date: "9999-12-31", chamber: "tlo" }; // current caption: used only when no journal prints one
  const file = join(work, "tlo", `${r.session}-${r.bill.replace(" ", "")}.html`);
  if (!existsSync(file)) {
    const res = await politeGet(`https://capitol.texas.gov/BillLookup/History.aspx?LegSess=89${r.session}&Bill=${r.bill.replace(" ", "")}`, { ...gap, allow404: true });
    writeFileSync(file, res ? await res.text() : "");
  }
  setTitle(r.session, r.bill, decodeXml(/id="lblCaptionText">([^<]*)</.exec(readFileSync(file, "utf8"))?.[1] ?? ""));
}
// The journals print a bill's caption when it is laid out, before floor amendments, and do not reprint it when an amendment
// rewrites it. So a vote that passes a version takes the caption of that version's official text on Texas Legislature
// Online: in the originating chamber the engrossed text (E: as passed there), in the other chamber and on concurrence /
// conference reports the enrolled text (F: as finally passed; not for a second-chamber passage when a conference
// committee rewrote the bill afterwards). Amendment, tabling and procedural votes, failed votes, and bills without that
// text (died, simple resolutions) keep the journal caption printed before the vote.
const TLO_CODE = { HB: "HB", SB: "SB", HJR: "HJ", SJR: "SJ", HCR: "HC", SCR: "SC" };
mkdirSync(join(work, "text"), { recursive: true });
const hadConference = new Set();
for (const chamber of ["lower", "upper"]) for (const r of rolls[chamber]) if (/conference committee report/.test(r.question)) hadConference.add(`${r.session}:${r.bill}`);
const versionOf = (r) => {
  const [type] = r.bill.split(" ");
  if (!TLO_CODE[type] || /^Failed/.test(r.outcome)) return null;
  if (/^(?:Concur in|Adopt conference committee report)/.test(r.question)) return "F";
  if (!/^(?:Final passage|Passage to|Adopt (?:HB|SB|HJR|SJR|HCR|SCR) )/.test(r.question)) return null;
  if ((r.chamber === "lower") === type.startsWith("H")) return "E";
  return hadConference.has(`${r.session}:${r.bill}`) ? null : "F";
};
const versionCaptions = new Map();
async function versionCaption(sess, bill, ver) {
  const [type, num] = bill.split(" ");
  const name = `${TLO_CODE[type]}${num.padStart(5, "0")}${ver}`;
  const key = `${sess}:${name}`;
  if (versionCaptions.has(key)) return versionCaptions.get(key);
  const file = join(work, "text", `${sess}-${name}.htm`);
  if (!existsSync(file)) {
    const res = await politeGet(`https://capitol.texas.gov/tlodocs/89${sess}/billtext/html/${name}.htm`, { ...gap, allow404: true });
    writeFileSync(file, res ? await res.text() : "");
  }
  const text = decodeXml(readFileSync(file, "utf8").replace(/<[^>]+>/g, " ")).replace(/[\s\u00a0]+/g, " ");
  const m = /\b((?:relating|proposing|requesting|directing|authorizing|granting|memorializing|designating|recognizing) .+?)\. BE IT (?:ENACTED|RESOLVED)/i.exec(text);
  const t = m ? clean(m[1]) : null;
  versionCaptions.set(key, t);
  return t;
}
const noTitle = new Set();
let fromText = 0;
for (const chamber of ["lower", "upper"]) for (const r of rolls[chamber]) {
  const ver = versionOf(r);
  const vt = ver ? await versionCaption(r.session, r.bill, ver) : null;
  if (vt) fromText++;
  const t = vt ?? titleAt(r.session, r.bill, r);
  r.title = t ? t.charAt(0).toUpperCase() + t.slice(1) : (noTitle.add(r.bill), r.bill);
}
const now = new Date().toISOString();
for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  await writeSnapshot(join(OUT_DIR, `state-tx-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("tx", chamber),
    sourceLabel: `Roll call · Texas ${chamber === "lower" ? "House" : "Senate"} floor votes (Texas Legislature journals)`,
    keyBy: "openstates",
    jurisdiction: "tx",
    legislativeChamber: chamber,
    rollCalls: list.map(({ chamber: _c, session: _s, ord: _o, ...r }) => r),
  }, { compact: true });
  const dates = list.map((r) => r.date).sort();
  console.log(`${chamber}: ${list.length} roll calls ${dates[0]}..${dates.at(-1)}`);
}
console.log(`captions from the text of the version voted: ${fromText}`);
console.log("bills without a title:", noTitle.size, [...noTitle].slice(0, 40));
console.log("ambiguous names:", Object.fromEntries(ambiguous));
console.log("unmatched names:", Object.fromEntries(unmatched));
