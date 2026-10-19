/**
 * Connecticut 2025 and 2026 floor roll calls from the General Assembly's own site (https://www.cga.ct.gov).
 * Replaces the sampled Open States files state-ct-{lower,upper}.json with every House and Senate roll call
 * that the bill status pages link to (passage, amendments, concurrence, ...; committee votes are not published
 * this way), parsed from the official per-roll-call PDFs.
 *
 * Pages (plain GET / the site's own public search form):
 *   POST /asp/CGABillInfo/CGABillInfoDisplay.asp   bill-number range search per session year -> bill numbers + titles
 *   /asp/cgabillstatus/cgabillstatus.asp?...       statement of purpose (official summary) and links /{year}/VOTE/{H|S}/PDF/*.PDF
 *   /{year}/VOTE/{H|S}/PDF/{year}{H|S}V-NNNNN-R00{BILL}-{H|S}V.PDF
 *       text PDF: "Taken on MM/DD", printed tally (Yea / Nay / absent and not voting / Necessary for passage) and the
 *       member roll (Y / N / X). House rows give "SURNAME" or "SURNAME, I." ; Senate rows give district + full name.
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/ct.csv (chamber + surname + initial,
 * then Open States' retired list, then chamber switchers). A roll call is kept only when the parsed member list
 * reproduces the printed tally (yes, no and absent) and every name resolved to exactly one person.
 * Simple resolutions (HR/SR) are omitted. "X" (absent / not voting) is stored as "absent".
 *
 * The site's certificate chain is incomplete, so curl runs with -k. Responses are cached in --work
 * (default ~/.cache/ct-leg); <= 3 requests/second. PDF text needs pypdf (PYTHONPATH, see pdf-batch.py).
 * Run: node scripts/ingest/ct-leg.mjs [--work dir]
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, sleep, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const SITE = "https://www.cga.ct.gov";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YEARS = [2025, 2026];
const RANGES = [["HB", 5001], ["SB", 1], ["HJ", 1], ["SJ", 1]]; // simple resolutions (HR/SR) are omitted

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/ct-leg");
for (const d of ["lists", "bills", "pdf"]) mkdirSync(join(work, d), { recursive: true });

let last = 0;
/** Throttled curl to a file (cached). Returns true when the file exists afterwards, false on 404. */
async function fetchTo(url, file, post) {
  if (existsSync(file)) return true;
  for (let attempt = 0; ; attempt++) {
    last = Math.max(last + 340, Date.now());
    const wait = last - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const a = ["-sk", "--max-time", "90", "-A", "Mozilla/5.0 (thefullrecord-ingest; civic transparency)", "-o", `${file}.part`, "-w", "%{http_code}"];
      if (post) a.push("-X", "POST", "-d", post);
      const code = await new Promise((resolve, reject) => execFile("curl", [...a, url], (e, out) => (e ? reject(e) : resolve(out.trim()))));
      if (code === "404") return false;
      if (code === "429" || code === "503") console.log(new Date().toISOString(), code, url);
      if (code !== "200") throw new Error(`${url} -> ${code}`);
      execFileSync("mv", [`${file}.part`, file]);
      return true;
    } catch (e) {
      if (attempt >= 6) throw e;
      await sleep(10000 * (attempt + 1));
    }
  }
}
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const text = (html) => decodeXml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
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
const people = csv(await (await politeGet("https://data.openstates.org/people/current/ct.csv")).text());
const cands = []; // { id, given, family (normalised full family name), last (last token), chamber (current members only) }
for (const p of people) cands.push({ id: p.id, given: norm(p.given_name), district: p.current_district, family: norm(p.family_name), last: norm(p.family_name.split(/[\s]+/).at(-1)), chamber: p.current_chamber });
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/ct/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), family: norm(rest.join("")), last: norm(rest.at(-1) ?? ""), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
// House roll calls print "SANCHEZ, E." for Open States' nicknamed members.
const OVERRIDE = {};
for (const [label, given, district] of [["SANCHEZ, E.", "Manny", "24"], ["SANCHEZ, J.", "Jimmy", "6"], ["SANCHEZ, I.", "Iris", "25"]])
  OVERRIDE[`lower:${label}`] = people.find((p) => p.current_chamber === "lower" && p.current_district === district && norm(p.given_name) === norm(given))?.id;
const unmatched = new Map(); const ambiguous = new Map();
/** Open States id for a roll-call label; null (and counted) when unknown or shared by several people. */
function person(chamber, label, district) {
  let fits;
  if (OVERRIDE[`${chamber}:${label}`]) return OVERRIDE[`${chamber}:${label}`];
  if (chamber === "upper") { // "JOHN W. FONFARA" (Open States says "Cathy" Osten: the seat number settles it)
    const k = norm(label);
    fits = cands.filter((c) => c.family && k.endsWith(c.family) && (k.startsWith(c.given) || (c.chamber === "upper" && c.district === district)));
  } else { // "JOHNSON, D." or "KAVROS DEGRAW"
    const m = /^(.*\S),\s*([A-Z])\.?$/.exec(label.trim());
    const k = norm(m ? m[1] : label), initial = m?.[2].toLowerCase();
    fits = cands.filter((c) => (c.family === k || c.last === k || (/\s/.test(label) && k.endsWith(c.family))) && (!initial || c.given[0] === initial)); // "KAVROS DEGRAW" is Open States "DeGraw"
  }
  for (const stage of [fits.filter((c) => c.chamber === chamber), fits.filter((c) => !c.chamber), fits.filter((c) => c.chamber && c.chamber !== chamber)]) {
    const ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { ambiguous.set(`${chamber}:${label}`, (ambiguous.get(`${chamber}:${label}`) ?? 0) + 1); return null; }
  }
  return null;
}

// --- Bill lists (one range search per year and series).
const bills = []; // { year, num ("HB05001"), title }
for (const year of YEARS) {
  for (const [prefix, low] of RANGES) {
    const file = join(work, "lists", `${year}-${prefix}.html`);
    await fetchTo(`${SITE}/asp/CGABillInfo/CGABillInfoDisplay.asp`, file,
      `cboSessYr=${year}&optFindM=range&txtLowBill=${prefix}${String(low).padStart(5, "0")}&txtHiBill=${prefix}09999`);
    const html = readFileSync(file, "latin1");
    for (const m of html.matchAll(/bill_num=([A-Z]{2}\d{5})&which_year=(\d{4})'>[^<]*<\/a>\s*<\/td>\s*<td>([\s\S]*?)<\/td>/g)) {
      if (Number(m[2]) !== year) continue;
      bills.push({ year, num: m[1], title: text(m[3]).replace(/ |&nbsp/g, " ").trim() });
    }
  }
}
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 0; // test aid: first N bills per year
if (limit) for (const y of YEARS) bills.splice(bills.findIndex((b) => b.year === y) + limit, bills.filter((b) => b.year === y).length - limit);
console.log(`${bills.length} bills listed`);

/** Run fn over items with a few workers; fetchTo spaces request starts, so total rate stays <= 3/s. */
async function pool(items, fn, size = 3) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) await fn(items[next++]); }));
}

// --- Bill status pages -> vote links.
const votes = new Map(); // pdf file name -> { year, chamber, rc, label, bill, summary, href }
let n = 0;
await pool(bills, async (b) => {
  if (++n % 250 === 0) console.log(`${n}/${bills.length} bill pages`);
  const file = join(work, "bills", `${b.year}-${b.num}.html`);
  if (!(await fetchTo(`${SITE}/asp/cgabillstatus/cgabillstatus.asp?selBillType=Bill&bill_num=${b.num}&which_year=${b.year}`, file))) return;
  const html = readFileSync(file, "latin1");
  const links = [...html.matchAll(/<a href="(\/(\d{4})\/VOTE\/([HS])\/PDF\/([^"]+?\.PDF))">([^<]*)<\/a>/gi)];
  if (!links.length) return;
  const purpose = text(/<h4>[\s\S]*?<\/h4>\s*<p class="text-justify">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "");
  for (const [, href, year, ch, name, label] of links) {
    const lm = /Roll Call Vote\s+(\d+)\s*(.*)/i.exec(text(label));
    votes.set(name, { year: Number(year), chamber: ch === "H" ? "lower" : "upper", rc: Number(lm?.[1] ?? 0), label: (lm?.[2] ?? "").trim(), href, bill: b, summary: purpose });
  }
});
console.log(`${votes.size} roll-call PDFs linked`);

// --- Download and convert PDFs.
let k = 0;
await pool([...votes], async ([name, v]) => {
  if (++k % 250 === 0) console.log(`${k}/${votes.size} PDFs`);
  v.ok = await fetchTo(`${SITE}${v.href}`, join(work, "pdf", name));
});
const pdfDir = join(work, "pdf");
const todo = readdirSync(pdfDir).filter((f) => /\.PDF$/i.test(f) && !existsSync(join(pdfDir, f.slice(0, -4) + ".txt"))).map((f) => join(pdfDir, f));
for (let i = 0; i < todo.length; i += 200)
  execFileSync("python3", [join(ROOT, "scripts/ingest/pdf-batch.py"), "layout", ...todo.slice(i, i + 200)], { stdio: "inherit", env: { ...process.env, PYTHONPATH: process.env.PYTHONPATH ?? "/tmp/claude-1000/pp" } });

// --- Parse.
const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
const codesSeen = {};
for (const [name, v] of votes) {
  const file = join(pdfDir, name.slice(0, -4) + ".txt");
  if (!v.ok || !existsSync(file)) { skip("no-pdf"); continue; }
  const t = readFileSync(file, "utf8");
  const num = (re) => { const m = re.exec(t); return m ? Number(m[1]) : null; };
  const yea = num(/Those voting Yea\s*\.*\s*(\d+)/), nay = num(/Those voting Nay\s*\.*\s*(\d+)/);
  const abs = num(/Those absent and not voting\s*\.*\s*(\d+)/), total = num(/Total Number Voting\s*\.*\s*(\d+)/);
  const need = num(/Necessary for (?:Passage|Adoption)[\s.]*(\d+)/);
  const dm = /Taken on\s+(\d{1,2})\/(\d{1,2})/.exec(t);
  const body = t.slice(t.search(/roll call vote:/i) + 1);
  if (yea == null || nay == null || abs == null || !dm || !/roll call vote:/i.test(t)) { skip("unparsed-header"); continue; }
  const day = `${v.year}-${dm[1].padStart(2, "0")}-${dm[2].padStart(2, "0")}`;
  if (day > now.slice(0, 10) || Number.isNaN(Date.parse(day))) { skip("bad-date"); continue; }
  const members = [];
  for (const line of body.split("\n").slice(1)) {
    const parts = line.trim().split(/\s{2,}/).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (!/^[A-Z]$/.test(parts[i])) continue;
      const skipDistrict = /^\d+$/.test(parts[i + 1] ?? ""); // Senate rows carry the district number between the code and the name
      const label = parts[i + 1 + (skipDistrict ? 1 : 0)];
      if (label && !/^[A-Z]$/.test(label)) { members.push([parts[i], label, skipDistrict ? parts[i + 1] : null]); i += 1 + (skipDistrict ? 1 : 0); }
    }
  }
  let y = 0, nn = 0, a = 0; const pos = {}; let bad = false;
  for (const [code, label, district] of members) {
    codesSeen[code] = (codesSeen[code] ?? 0) + 1;
    const position = code === "Y" ? "yes" : code === "N" ? "no" : code === "X" || code === "A" ? "absent" : null; // Senate prints A, House X
    if (!position) { bad = true; continue; }
    if (position === "yes") y++; else if (position === "no") nn++; else a++;
    const id = person(v.chamber, label, district);
    if (!id) { const key = `${v.chamber}:${label}`; unmatched.set(key, (unmatched.get(key) ?? 0) + 1); bad = true; continue; }
    if (id in pos) { bad = true; continue; }
    pos[id] = position;
  }
  if (bad) { skip("unresolved-member-or-code"); continue; }
  if (y !== yea || nn !== nay || a !== abs || (total != null && y + nn !== total)) { skip("tally-mismatch"); continue; }
  const label = v.label.replace(/\s+/g, " ");
  rolls[v.chamber].push({
    id: `ct-${v.year}-${v.chamber === "lower" ? "h" : "s"}-${v.rc}-${v.bill.num.toLowerCase()}`, // one roll call can cover several joint resolutions, each with its own bill page
    bill: `${v.bill.num.slice(0, 2)} ${Number(v.bill.num.slice(2))}`,
    title: v.bill.title,
    ...(v.summary && v.summary.toLowerCase() !== v.bill.title.toLowerCase() ? { summary: v.summary, summarySource: "official" } : {}),
    ...(label ? { question: label } : {}),
    kind: classify({ motion_text: label, motion_classification: [] }),
    outcome: `${(need != null ? yea >= need : yea > nay) ? "Passed" : "Failed"} ${yea}–${nay}`,
    date: day,
    dateLabel: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`,
    sourceUrl: `${SITE}${v.href}`,
    votes: pos,
  });
}

console.log("skipped:", skipped, "| vote codes:", codesSeen);
console.log("ambiguous names:", Object.fromEntries(ambiguous), "\nunmatched names:", Object.fromEntries(unmatched));
for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id, "en", { numeric: true }));
  await writeSnapshot(join(OUT, `state-ct-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("ct", chamber),
    sourceLabel: `Roll call · Connecticut ${chamber === "lower" ? "House" : "Senate"} floor votes (Connecticut General Assembly)`,
    keyBy: "openstates",
    jurisdiction: "ct",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls (${list.at(-1)?.date} to ${list[0]?.date}), ${list.filter((r) => r.summary).length} with official summary`);
}
console.log("skipped:", skipped, "| vote codes:", codesSeen);
console.log("ambiguous names:", Object.fromEntries(ambiguous));
console.log("unmatched names:", Object.fromEntries(unmatched));
