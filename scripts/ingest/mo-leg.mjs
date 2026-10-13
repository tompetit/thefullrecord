/**
 * Missouri 2025 and 2026 Regular Session floor votes from the General Assembly's own daily journals.
 * Replaces any sampled Open States files state-mo-{lower,upper}.json with every House and Senate floor roll call on a
 * bill or joint/concurrent resolution (third reading and passage, final passage, conference reports, emergency clauses,
 * amendments and previous-question motions that were taken by roll call). Committee votes (the "Ayes (7): ..." blocks in
 * committee reports), journal approvals, quorum calls, nominations and simple resolutions (HR/SR) are not imported.
 *
 * Sources (plain GETs of public files; missouri has no per-member vote feed, so the printed journals are the record):
 *   https://documents.house.mo.gov/BillTracking/bills{251|261}/jrnpdf/jrnNNN.pdf   House Journal, one text PDF per day (probed until missing)
 *   https://www.senate.mo.gov/journallist/?SelectedYear=YYYY -> /{YY}info/Journals/*.pdf   Senate Journal, one text PDF per day
 *   https://documents.house.mo.gov/xml/{251|261}-{HB}.xml   House bill XML: ShortTitle and LongTitle (the official one-line summary) of House bills
 * (house.mo.gov itself answers 403 to non-browser clients, so bill pages are not used.) Special sessions are not imported.
 *
 * House journals print "AYES: n / NOES: n / PRESENT: n / ABSENT WITH LEAVE: n" with surnames (plus the district number where
 * two members share a surname, "Brown 149"); Senate journals print "YEAS—Senators ... —n" the same way, "Brown (16)".
 * Names are matched to Open States people (current + retired role histories from github.com/openstates/people, cached) by
 * chamber, surname, district and the vote date. Each stored tally must equal the printed count of every list, otherwise the
 * roll call is dropped and counted. A name that fits no one or several people is reported and the roll call is dropped
 * (no partial voter lists).
 *
 * PDF text needs pypdf: PYTHONPATH=/tmp/claude-1000/pp (see pdf-fulltext.py). Cache: --work (default ~/.cache/mo-leg).
 * Run: PYTHONPATH=... node scripts/ingest/mo-leg.mjs [--work dir]
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/mo-leg");
for (const d of ["hj", "hjt", "sj", "sjt", "people", "xml"]) mkdirSync(join(work, d), { recursive: true });
const gap = { minGapMs: 400 };
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

// ---------------------------------------------------------------- download journals
/** Cached binary GET; null when the server answers 404 or a non-PDF page (the House site returns an HTML "200" for missing days). */
async function getPdf(url, file) {
  if (existsSync(file)) return file;
  const res = await politeGet(url, { ...gap, allow404: true });
  if (!res) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 4).toString() !== "%PDF") return null;
  writeFileSync(file, buf);
  return file;
}

const houseDays = []; // { file, chamber, session, url, name }
for (const [year, code] of [[2025, 251], [2026, 261]]) {
  let miss = 0;
  for (let n = 1; miss < 3 && n < 200; n++) {
    const name = `jrn${String(n).padStart(3, "0")}`;
    const url = `https://documents.house.mo.gov/BillTracking/bills${code}/jrnpdf/${name}.pdf`;
    const file = await getPdf(url, join(work, "hj", `${code}-${name}.pdf`));
    if (!file) { miss++; continue; }
    miss = 0;
    houseDays.push({ file, chamber: "lower", url, name: `${code}-${name}` });
  }
}
const senateDays = [];
for (const year of [2025, 2026]) {
  const yy = String(year).slice(2);
  const listing = join(work, "sj", `list-${year}.html`);
  if (!existsSync(listing)) writeFileSync(listing, await (await politeGet(`https://www.senate.mo.gov/journallist/?SelectedYear=${year}`, gap)).text());
  const links = [...new Set([...readFileSync(listing, "utf8").matchAll(/href="(\/\d\dinfo\/Journals\/[^"]+\.pdf)"/g)].map((m) => m[1]))];
  for (const link of links) {
    // R(egular) days only, plus the September 2025 veto session (listed under both years); special sessions (T1/T2) are not regular session.
    if (!new RegExp(`^/${yy}info/Journals/(R[Dd]ay|VDay)`).test(link)) continue;
    const url = `https://www.senate.mo.gov${link}`;
    const file = await getPdf(url, join(work, "sj", `${yy}-${basename(link)}`));
    if (file) senateDays.push({ file, chamber: "upper", url, name: `${yy}-${basename(link, ".pdf")}` });
  }
}
console.log(`${houseDays.length} House journals, ${senateDays.length} Senate journals`);

// PDF -> text (cached), a few files per python call
const pending = [...houseDays, ...senateDays].filter((d) => !existsSync(textFile(d)));
function textFile(d) { return join(work, d.chamber === "lower" ? "hjt" : "sjt", `${d.name}.txt`); }
for (let i = 0; i < pending.length; i += 25) {
  const chunk = pending.slice(i, i + 25);
  await new Promise((resolve, reject) => execFile("python3", [join(dirname(fileURLToPath(import.meta.url)), "pdf-fulltext.py"), ...chunk.flatMap((d) => [d.file, textFile(d)])],
    { env: { ...process.env, PYTHONPATH: process.env.PYTHONPATH ?? "/tmp/claude-1000/pp" } }, (e, _o, err) => (e ? reject(e) : (err && console.warn(err), resolve()))));
}

// ---------------------------------------------------------------- roster (Open States people, role histories)
async function peopleFiles(dir) {
  const cache = join(work, "people", `${dir}.json`);
  if (!existsSync(cache)) {
    const list = await (await politeGet(`https://api.github.com/repos/openstates/people/contents/data/mo/${dir}`, { ...gap, headers: { Accept: "application/vnd.github+json" } })).json();
    writeFileSync(cache, JSON.stringify(list.map((x) => ({ name: x.name, url: x.download_url }))));
  }
  return JSON.parse(readFileSync(cache, "utf8"));
}
/** { id, keys:Set(name spellings), roles:[{type,district,start,end}] } for every current and retired Missouri legislator. */
const roster = [];
for (const dir of ["legislature", "retired"]) {
  for (const f of await peopleFiles(dir)) {
    const file = join(work, "people", f.name);
    if (!existsSync(file)) writeFileSync(file, await (await politeGet(f.url, { minGapMs: 250 })).text());
    const y = readFileSync(file, "utf8").split(/\n(?=other_identifiers:|links:|sources:|offices:)/)[0];
    const id = /^id: (\S+)/m.exec(y)?.[1];
    const family = /^family_name: (.+)$/m.exec(y)?.[1]?.replace(/^['"]|['"]$/g, "") ?? "";
    const given = /^given_name: (.+)$/m.exec(y)?.[1]?.replace(/^['"]|['"]$/g, "") ?? "";
    const rolesText = /^roles:\n([\s\S]*?)(?=^(?!- |  )\S)/m.exec(`${y}\nend:`)?.[1] ?? "";
    const roles = rolesText.split(/^- /m).filter(Boolean).map((r) => ({
      type: /type: (\w+)/.exec(r)?.[1], district: /district: '?([^'\n]+)'?/.exec(r)?.[1],
      start: /start_date: '?([\d-]+)/.exec(r)?.[1] ?? "0000", end: /end_date: '?([\d-]+)/.exec(r)?.[1] ?? "9999",
    })).filter((r) => (r.type === "lower" || r.type === "upper") && r.end >= "2024-12-01");
    if (!id || !roles.length) continue;
    const ALIAS = { moore: "walshmoore" }; // Open States lists Bridget Walsh Moore as "Moore"; journals print "Walsh Moore"
    const keys = new Set([ALIAS[norm(family)], norm(family), norm(family.split(/[\s-]+/).at(-1)), norm(family.split(/[\s-]+/)[0])]);
    roster.push({ id, keys, current: dir === "legislature", given: norm(given), roles });
  }
}
console.log(`${roster.length} legislators with a 2025+ role`);

const unmatched = new Map(), ambiguous = new Map();
/** Open States id for a journal name, or null when none/several fit. district is the number printed beside shared surnames. */
function person(chamber, nameKey, district, date) {
  const fits = (loose) => roster.filter((p) => p.keys.has(nameKey) && p.roles.some((r) => r.type === chamber && (!district || r.district === district) && (loose || (r.start <= date && date <= r.end))));
  let c = fits(false);
  if (!c.length) c = fits(true);
  if (c.length > 1 && c.filter((p) => p.current).length === 1) c = c.filter((p) => p.current); // Open States holds a few duplicate records for one person
  return c.length === 1 ? c[0].id : c.length ? "ambiguous" : null;
}

// ---------------------------------------------------------------- journal text
/** Clean page text: strips page headers/footers; pages[] = char offset where each PDF page starts. */
function load(d) {
  const raw = readFileSync(textFile(d), "utf8").split("\f@@PAGE ").slice(1);
  let text = ""; const starts = [];
  for (const page of raw) {
    starts.push(text.length);
    const lines = page.replace(/^\d+\n/, "").split("\n").filter((l) => !/^\s*\d+\s+Journal of the (House|Senate)\s*$/.test(l) && !/^\s*Journal of the (House|Senate)\s+\d+\s*$/.test(l)
      && !/^\s*\d+\s+\S+(-\S+)?\s+Day\s*[–-]\s*\w+day, \w+ \d+, \d{4}\s*$/.test(l) && !/^\s*\S+(-\S+)?\s+Day\s*[–-]\s*\w+day, \w+ \d+, \d{4}\s+\d+\s*$/.test(l));
    text += `${lines.join("\n")}\n`;
  }
  const m = new RegExp(`(${MONTH_NAMES.join("|")}) (\\d{1,2}), (\\d{4})`, "i").exec(text.slice(0, 3000));
  if (!m) return null;
  const date = `${m[3]}-${String(MONTH_NAMES.indexOf(m[1].toUpperCase()) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return { text, starts, date };
}
const pageOf = (starts, pos) => starts.findIndex((s, i) => s <= pos && (i + 1 >= starts.length || starts[i + 1] > pos)) + 1;

const BILL = /\b(HB|SB|HJR|SJR|HCR|SCR|HR|SR)s?\s+(\d+)/;
const BILL_FULL = /\b(House|Senate)\s+(Joint\s+|Concurrent\s+)?(Resolution|Bill)s?\s+(?:No\.|Nos\.)?\s*(\d+)/i;
const fullToAbbr = (m) => `${m[1][0]}${m[2] ? m[2][0] : ""}${m[3][0]}`.toUpperCase() + ` ${m[4]}`;
function billIn(s) {
  const all = [...s.matchAll(new RegExp(`${BILL.source}|${BILL_FULL.source}`, "gi"))];
  if (!all.length) return null;
  const m = all.at(-1); // rightmost: "HA 7 to SS for SB 98" names the bill last
  return /^(?:House|Senate)\b/i.test(m[0]) ? fullToAbbr(BILL_FULL.exec(m[0])) : `${BILL.exec(m[0])[1].toUpperCase()} ${BILL.exec(m[0])[2]}`;
}
/** Bill references that open a discussion in a day's journal: "Amend ... House Bill No. 1" headers and "HB 1 ... was taken up / read the third time / be adopted". */
function markers(text) {
  const out = [];
  const any = new RegExp(`${BILL.source}|${BILL_FULL.source}`, "gi");
  for (const m of text.matchAll(any)) {
    const before = text.slice(Math.max(0, m.index - 160), m.index).replace(/\s+/g, " ");
    const after = text.slice(m.index, m.index + 260).replace(/\s+/g, " ");
    const frag = before.slice(before.lastIndexOf(". ") + 1);
    const tail = after.split(/\. /)[0];
    if (/\bamend\b/i.test(frag) || /taken up|appointed on|read the (third|3rd) time|truly agreed|be (adopted|perfected|recommitted|referred|passed|laid|amended)|was adopted|called from|finally passed|was ordered|as amended/.test(tail)) out.push({ pos: m.index, bill: billIn(m[0]) });
  }
  return out;
}
/** The bill a vote concerns: named in the lead-in sentence, else the latest bill under discussion before it. */
function billFor(text, pos, marks) {
  const lead = text.slice(Math.max(0, pos - 450), pos).replace(/\s+/g, " ");
  const parts = sentences(lead);
  for (let n = 1; n <= 3 && n <= parts.length; n++) {
    const found = billIn(parts.slice(-n)[0]);
    if (found) return found;
  }
  return marks.filter((k) => k.pos < pos && k.pos > pos - 400000).at(-1)?.bill ?? null;
}

// Sentence split that does not cut "Amendment No. 2" or "Mr. Speaker".
const sentences = (t) => t.split(/(?<!\bNos?|\bMr|\bMrs|\bDr)\. (?=[A-Z“"])/);
const AMENDMENT = /(?:(House|Senate) Amendment No\. (\d+)|\b(HA|SA|HSA|SSA)\s*(\d+))/;
function describe(leadRaw) {
  const lead = leadRaw.replace(/\s+/g, " ").trim();
  const parts = sentences(lead);
  const clean = (t) => t.replace(/\s*(?:, which motion \w+ )?by the following vote.*$/i, "").replace(/^.*?\bOn motion of (?:Representative|Senator) [^,]+?(?: \(\d+\))?, /, "").replace(/^.*?\bSenator [^,]+? moved that (?:the )?/, "").trim();
  const last = clean(parts.at(-1));
  const prev = clean(parts.at(-2) ?? "");
  const nospace = parts.at(-1).replace(/\s+/g, "");
  const verbFail = /defeated|failed|lost|notadopted|didnotprevail/i.test(nospace);
  const amend = (t) => {
    const m = AMENDMENT.exec(t);
    if (!m) return null;
    const who = m[1] ?? (m[3][0] === "H" ? "House" : "Senate");
    return `Adopt ${who} Amendment ${m[2] ?? m[4]}`;
  };
  let question, passage = false;
  const motion = /^Which motion/i.test(last);
  const subject = motion ? prev : last;
  if (/emergency clause/i.test(subject)) question = "Emergency clause";
  else if (/\btitle\b.*agreed to/i.test(subject)) question = "Agree to the title";
  else if (/vote by which|reconsider/i.test(subject)) question = `Reconsider: ${subject.replace(/^.*?\bmoved that (?:the )?/i, "").replace(/\.$/, "")}`;
  else if (/taken up/i.test(subject)) question = `Take up: ${subject.replace(/^.*?\bmoved that /i, "").replace(/ be taken up.*$| was taken up.*$/i, "")}`;
  else if (/previous question/i.test(subject)) question = "Previous question";
  else if (/(readthe(third|3rd)time|thirdread)and(passed|defeated)/i.test(subject.replace(/\s+/g, ""))) { question = "Third reading and passage"; passage = true; }
  else if (/finally passed/i.test(subject)) { question = "Final passage (truly agreed to and finally passed)"; passage = true; }
  else if (/conference committee report|\bCC[RS]\b.*adopted/i.test(subject)) { question = "Adopt conference committee report"; passage = true; }
  else if (amend(subject)) question = amend(subject);
  else if (/was adopted|be adopted|failed of adoption/.test(subject) && !motion) { question = `Adopt ${subject.replace(/,? (was|be) adopted.*$/, "").replace(/,? failed of adoption.*$/, "")}`; passage = /\b(HB|SB|HJR|SJR|HCR|SCR)\b/.test(question); }
  else if (motion || /\bmoved that\b/.test(subject)) question = `Motion: ${subject.replace(/^.*?\b(?:again )?moved (?:that )?/i, "").replace(/\.$/, "")}`;
  else question = subject;
  question = question.replace(/\s+/g, " ").slice(0, 200);
  return { question, verbFail, passage };
}

/** Names of one list -> [{ key, district }]. House: columns split by 2+ spaces. Senate: whitespace, "(16)" after the surname. */
function names(chamber, block) {
  if (chamber === "lower") {
    return block.replace(/(\S)\s{2,}(\d{1,3})(?=\s|$)/g, "$1 $2").split(/\s{2,}|\n/).map((t) => t.trim()).filter(Boolean).map((t) => {
      if (/^Mr\.?\s*Speaker$/i.test(t.replace(/\s+/g, " "))) return { key: "speaker", district: null, raw: t };
      const m = /^(\D*?)\s*([\d\s]*)$/.exec(t);
      return { key: norm(m[1]), district: m[2].replace(/\s/g, "") || null, raw: t };
    });
  }
  return block.replace(/\s*\((\d+)\)/g, "~$1").split(/\s+/).filter(Boolean).map((t) => {
    const [n, d] = t.split("~");
    return { key: norm(n), district: d ?? null, raw: t };
  });
}

const rolls = { lower: [], upper: [] };
const drops = {}; const drop = (why) => { drops[why] = (drops[why] ?? 0) + 1; };
const found = { lower: 0, upper: 0 };
const SPEAKER = "patterson"; // Speaker of the House for the whole 103rd General Assembly (journals: "Speaker Patterson in the Chair")

function resolveList(chamber, list, date, ctxLabel) {
  const ids = [];
  for (const n of list) {
    const key = n.key === "speaker" ? SPEAKER : n.key;
    const id = person(chamber, key, n.district, date);
    if (id === "ambiguous") { ambiguous.set(`${chamber}:${n.raw}`, (ambiguous.get(`${chamber}:${n.raw}`) ?? 0) + 1); return null; }
    if (!id) { unmatched.set(`${chamber}:${n.raw}`, (unmatched.get(`${chamber}:${n.raw}`) ?? 0) + 1); return null; }
    ids.push(id);
  }
  return ids;
}

for (const d of [...houseDays, ...senateDays]) {
  const j = load(d);
  if (!j) { drop("no-date"); continue; }
  const { text, starts, date } = j;
  const chamber = d.chamber;
  const re = chamber === "lower"
    ? /^AYES:\s*(\d+)[ \t]*\n([\s\S]*?)^NOES:\s*(\d+)[ \t]*\n([\s\S]*?)^PRESENT:\s*(\d+)[ \t]*\n([\s\S]*?)^ABSENT WITH LEAVE:\s*(\d+)[ \t]*\n([\s\S]*?)^VACANCIES:[^\n]*/gm
    : /^YEAS.Senators[ \t]*\n([\s\S]*?)^Vacancies[^\n]*/gm;
  const expected = (text.match(chamber === "lower" ? /^AYES:\s*\d+/gm : /^YEAS.Senators/gm) ?? []).length;
  found[chamber] += expected;
  let floor = 0, seq = 0, matched = 0;
  const marks = markers(text);
  for (const m of text.matchAll(re)) {
    matched++;
    const prevEnd = floor;
    const lead = text.slice(Math.max(floor, m.index - 450), m.index);
    floor = m.index + m[0].length;
    if (!/followingvote|followingrollcall/.test(lead.replace(/\s+/g, ""))) { drop("no-lead"); if (args.includes("--dry")) console.log("NOLEAD", d.name, JSON.stringify(lead.slice(-160))); continue; }
    if (/quorum|pprovedas|waselected|confirm|nominat/i.test(lead.slice(-220).replace(/\s+/g, ""))) { drop("not-a-bill-vote"); if (args.includes("--dry")) console.log("NOTBILL", d.name, JSON.stringify(lead.slice(-200))); continue; }
    const bill = billFor(text, m.index, marks);
    if (!bill) { drop("no-bill"); if (args.includes("--dry")) console.log("NOBILL", d.name, JSON.stringify(lead.slice(-200))); continue; }
    if (/Rule \d+ (?:again )?be suspended/i.test(lead.replace(/\s+/g, " ").slice(-220))) { drop("rule-suspension"); continue; }
    if (/^(HR|SR)\b/.test(bill)) { drop("simple-resolution"); continue; }
    // Parse lists
    let lists, counts;
    if (chamber === "lower") {
      lists = { yes: m[2], no: m[4], present: m[6], absent: m[8] };
      counts = { yes: +m[1], no: +m[3], present: +m[5], absent: +m[7] };
    } else {
      const parts = m[0].replace(/^Vacancies[^\n]*/m, "").split(/^(?=(?:YEAS|NAYS|Present|Absent with leave|Absent)\s*[—–-]\s*Senators?)/im).filter(Boolean);
      lists = { yes: "", no: "", present: "", absent: "" }; counts = { yes: 0, no: 0, present: 0, absent: 0 };
      for (const p of parts) {
        const h = /^(YEAS|NAYS|Present|Absent with leave|Absent)\s*[—–-]\s*Senators?\s*(?:[—–-]\s*(None|\d+))?/i.exec(p);
        if (!h) continue;
        const slot = /yeas/i.test(h[1]) ? "yes" : /nays/i.test(h[1]) ? "no" : /present/i.test(h[1]) ? "present" : "absent";
        const body = p.slice(h[0].length);
        const cnt = /[—–-]\s*(\d+)\s*$/.exec(body.trim());
        lists[slot] += ` ${cnt ? body.trim().slice(0, cnt.index) : body}`;
        counts[slot] += cnt ? +cnt[1] : h[2] && h[2] !== "None" ? +h[2] : 0; // "NAYS—Senators—2" may also lead the names
      }
    }
    const votes = {}; let bad = false;
    for (const [slot, block] of Object.entries(lists)) {
      const list = names(chamber, block.trim());
      if (list.length !== counts[slot]) { drop(`tally-mismatch(${slot})`); if (args.includes("--dry")) console.log("MISMATCH", d.name, date, bill, slot, list.length, counts[slot]); bad = true; break; }
      const ids = resolveList(chamber, list, date, slot);
      if (!ids) { drop("unmatched-or-ambiguous-member"); bad = true; break; }
      for (const id of ids) votes[id] = slot;
    }
    if (bad) continue;
    if (Object.keys(votes).length !== counts.yes + counts.no + counts.present + counts.absent) { drop("duplicate-member"); continue; }
    const info = describe(lead);
    const failed = info.verbFail;
    if (!failed && counts.yes < counts.no) { drop("outcome-conflict"); if (args.includes("--dry")) console.log("CONFLICT", d.name, bill, info.question, counts.yes, counts.no); continue; }
    const page = pageOf(starts, m.index);
    rolls[chamber].push({
      id: `mo-${chamber === "lower" ? "h" : "s"}-${date.replace(/-/g, "")}-${String(++seq).padStart(2, "0")}${d.name.includes("VDay") ? "v" : ""}`,
      bill, date, chamber,
      question: info.question,
      kind: /^Agree to the title/.test(info.question) ? "procedural" : classify({ motion_text: info.question, motion_classification: info.passage ? ["passage"] : [] }),
      outcome: `${failed ? "Failed" : "Passed"} ${counts.yes}–${counts.no}`,
      dateLabel: `${MONTHS[+date.slice(5, 7) - 1]} ${+date.slice(8, 10)}, ${date.slice(0, 4)}`,
      sourceUrl: `${d.url}#page=${page}`,
      votes,
    });
  }
  if (matched !== expected) { drop(`unparsed-vote-block`); console.log("UNPARSED", d.name, matched, expected); }
}
const total = (c) => rolls[c].length;
console.log(`found ${found.lower}/${found.upper} vote blocks; kept ${total("lower")} House, ${total("upper")} Senate before titles`);
if (args.includes("--dry")) { console.log("dropped:", drops, "\nambiguous:", Object.fromEntries(ambiguous), "\nunmatched:", Object.fromEntries(unmatched)); process.exit(0); }

// ---------------------------------------------------------------- titles and official summaries
const titles = new Map();
function setTitle(bill, t) { if (t && !titles.has(bill)) titles.set(bill, t.replace(/\s+/g, " ").trim().replace(/[,;]$/, "")); }
for (const d of [...senateDays, ...houseDays]) {
  const j = load(d); if (!j) continue;
  const flat = j.text.replace(/\n(?!\n)/g, " ");
  for (const m of flat.matchAll(/\b(SB|SJR|HB|HJR|HCR|SCR) (\d+) [–—-] By [^.]{0,120}?\.\s+(An Act|Joint Resolution|Concurrent Resolution)[^]*?relating to ([^.]*?)(?:, with |\.)/g)) setTitle(`${m[1]} ${m[2]}`, `Relating to ${m[4]}`);
  for (const m of flat.matchAll(/\b(SB|SJR|HB|HJR|HCR|SCR) (\d+), relating to ([^,]+?)(?:, (?:was|with|as|and|on)\b|,? \()/g)) setTitle(`${m[1]} ${m[2]}`, `Relating to ${m[3]}`);
}
const xmlCache = new Map();
async function houseXml(bill, date) {
  const [type, num] = bill.split(" ");
  if (!/^H/.test(type)) return null;
  if (xmlCache.has(bill)) return xmlCache.get(bill);
  let out = null;
  for (const code of date < "2026" ? ["251", "261"] : ["261", "251"]) {
    const file = join(work, "xml", `${code}-${type}${num}.xml`);
    let body = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (body === null) {
      const res = await politeGet(`https://documents.house.mo.gov/xml/${code}-${type}${num}.xml`, { ...gap, allow404: true });
      body = res ? await res.text() : "";
      writeFileSync(file, body);
    }
    const short = /<ShortTitle>([\s\S]*?)<\/ShortTitle>/.exec(body)?.[1];
    if (short) { out = { short: decodeXml(short), long: decodeXml(/<LongTitle>([\s\S]*?)<\/LongTitle>/.exec(body)?.[1] ?? "") }; break; }
  }
  xmlCache.set(bill, out);
  return out;
}
const sentence = (s) => { const t = s.toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
const noTitle = new Set();
for (const chamber of ["lower", "upper"]) {
  for (const r of rolls[chamber]) {
    const x = await houseXml(r.bill, r.date);
    r.title = titles.get(r.bill) ?? (x?.short ? sentence(x.short) : (noTitle.add(r.bill), r.bill));
    if (x?.long && x.long.length > 12 && x.long.toLowerCase() !== r.title.toLowerCase()) { r.summary = x.long; r.summarySource = "official"; }
    r.kind ??= "substantive";
  }
}

const now = new Date().toISOString();
for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const ordered = list.map(({ chamber: _c, ...r }) => r);
  await writeSnapshot(join(OUT, `state-mo-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("mo", chamber),
    sourceLabel: `Roll call · Missouri ${chamber === "lower" ? "House" : "Senate"} floor votes (Missouri General Assembly journals)`,
    keyBy: "openstates",
    jurisdiction: "mo",
    legislativeChamber: chamber,
    rollCalls: ordered,
  }, { compact: true });
  const dates = list.map((r) => r.date).sort();
  console.log(`${chamber}: ${list.length} roll calls ${dates[0]}..${dates.at(-1)}, ${list.filter((r) => r.summary).length} with official summary`);
}
console.log("dropped:", drops);
console.log("bills without a title:", [...noTitle]);
console.log("ambiguous names:", Object.fromEntries(ambiguous));
console.log("unmatched names:", Object.fromEntries(unmatched));
