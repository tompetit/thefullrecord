/**
 * Ohio 136th General Assembly (2025-26) floor votes from the Legislature's own site
 * (https://www.legislature.ohio.gov). Replaces the sampled Open States files state-oh-{lower,upper}.json with every
 * House and Senate recorded floor vote shown on a bill's "Votes" tab (passage, concurrence, ...). The tab also lists
 * standing-committee votes (Result "Favorable Passage" / "Re-referred"); only floor rows (Result "Passed", "Failed",
 * "Adopted") are kept, and that official Result (not yeas > nays) gives the outcome.
 *
 * Sources:
 *   search-prod.lis.state.oh.us/api/v2/general_assembly_136/legislation/   every bill + short_title (one request)
 *   www.legislature.ohio.gov/legislation/136/{bill}/votes                   server-rendered HTML: date, chamber,
 *       per-member Yeas / Nays lists (name, party, link to the member's page)
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/oh.csv: first by the member-page
 * slug (the CSV's ohiohouse.gov/ohiosenate.gov member links), then by chamber + name; former members fall back to
 * Open States' retired list on full name. Simple resolutions (HR/SR) are omitted. The Votes tab carries no motion text
 * and no absentee list, so `question` is omitted and only recorded Yeas/Nays are stored.
 * Summary: the opening bullets of the latest LSC bill analysis PDF listed on the bill's Documents tab
 * (SUMMARY / Highlights / Synopsis section), text-extracted by pdf-text.py (needs pypdf; set PYTHONPATH if not
 * installed), joined into sentences and trimmed; omitted when the bill has no analysis.
 *
 * Both hosts have an incomplete certificate chain, so requests go through `curl -k`; responses are cached in --work
 * (default ~/.cache/oh-leg) so reruns make no requests (<= 3 requests/second otherwise).
 * Run: node scripts/ingest/oh-leg.mjs [--work dir]
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, sleep, writeSnapshot } from "./shared.mjs";
import { billSummary, classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const API = "https://search-prod.lis.state.oh.us/api/v2/general_assembly_136/legislation/";
const SITE = "https://www.legislature.ohio.gov/legislation/136";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHAMBER = { House: "lower", Senate: "upper" };

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/oh-leg");
mkdirSync(work, { recursive: true });

let last = 0;
async function get(url, name) {
  const file = join(work, name);
  if (existsSync(file)) return readFileSync(file, "utf8");
  for (let attempt = 0; ; attempt++) {
    last = Math.max(last + 350, Date.now());
    const wait = last - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const body = await new Promise((resolve, reject) =>
        execFile("curl", ["-sk", "--max-time", "60", "-A", "Mozilla/5.0 (thefullrecord-ingest; civic transparency)", "-w", "\n%{http_code}", url],
          { maxBuffer: 64e6 }, (e, out) => (e ? reject(e) : resolve(out))));
      const code = body.slice(body.lastIndexOf("\n") + 1);
      const text = body.slice(0, body.lastIndexOf("\n"));
      if (code !== "200") throw new Error(`${url} -> ${code}`);
      writeFileSync(file, text);
      return text;
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(1000 * 2 ** attempt);
    }
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

// --- Roster.
const people = csv(await (await politeGet("https://data.openstates.org/people/current/oh.csv")).text());
const bySlug = new Map(), byName = new Map(); // slug / "chamber:name" -> ocd-person id
for (const p of people) {
  for (const m of (p.links + ";" + p.sources).matchAll(/\/members\/([a-z0-9-]+)/g)) bySlug.set(m[1], p.id);
  byName.set(`${p.current_chamber}:${norm(p.name)}`, p.id);
  byName.set(`${p.current_chamber}:${norm(p.given_name)}${norm(p.family_name)}`, p.id);
}
const retired = new Map();
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/oh/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (m) retired.set(norm(m[1]), `ocd-person/${m[2]}`);
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }

const unmatched = new Map();
function person(chamber, slug, name) {
  const n = norm(name.replace(/\([^)]*\)/, ""));
  const first = norm(name.split(/\s+/)[0]), lastW = norm(name.replace(/\([^)]*\)/, "").trim().split(/\s+/).pop());
  return (slug && bySlug.get(slug)) || byName.get(`${chamber}:${n}`) || byName.get(`${chamber}:${first}${lastW}`) || retired.get(n) || retired.get(first + lastW);
}

// --- Bills.
const bills = JSON.parse(await get(API, "legislation.json")).filter((b) => !/^(hr|sr)\d/.test(b.number));
const label = (n) => n.replace(/^([a-z]+)(\d+)$/, (_, a, d) => `${a.toUpperCase()} ${d}`);

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const skipped = {}, results = {}; let tallyMismatch = 0, n = 0;
// Votes-tab "Result" -> outcome verb. Floor rows read "Passed"/"Failed" (bills) or "Adopted" (concurrent and joint
// resolutions, kept in this importer's Passed/Failed format). Committee rows ("Favorable Passage", "Re-referred") and
// anything unknown are skipped (counted under "not-floor (...)" in the run log).
const FLOOR_RESULT = { Passed: "Passed", Failed: "Failed", Adopted: "Passed" };
const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
for (const b of bills) {
  if (++n % 200 === 0) console.log(`${n}/${bills.length} bills`);
  const html = await get(`${SITE}/${b.number}/votes`, `votes-${b.number}.html`);
  const rows = html.split('<th class="date-cell"').slice(1);
  const seen = {};
  for (const row of rows) {
    const date = /<span>(\d+)-(\d+)-(\d{4})<\/span>/.exec(row);
    const chamber = CHAMBER[/chamber-cell">\s*<span>(\w+)<\/span>/.exec(row)?.[1]];
    if (!date || !chamber) { skip("bad-row"); continue; }
    const day = `${date[3]}-${date[1].padStart(2, "0")}-${date[2].padStart(2, "0")}`;
    // The id's per-day sequence counts every row on the tab (committee rows too) so existing ids stay stable.
    const k = `${chamber}-${day}`; seen[k] = (seen[k] ?? 0) + 1;
    // The tab's "Result" column is the official result. Besides floor votes it lists standing-committee votes
    // ("Favorable Passage" reports, "Re-referred"; 9-4 style tallies), which are not floor votes.
    const result = decodeXml(/result-cell">([^<]*)</.exec(row)?.[1] ?? "").replace(/\s+/g, " ").trim();
    results[result] = (results[result] ?? 0) + 1;
    if (!FLOOR_RESULT[result]) { skip(result ? `not-floor (${result})` : "no-result"); continue; }
    const yea = Number(/Yeas: (\d+)/.exec(row)?.[1]), nay = Number(/Nays: (\d+)/.exec(row)?.[1]);
    const votes = {}; let yes = 0, no = 0;
    for (const sec of row.split("<h3>").slice(1)) {
      const pos = { Yeas: "yes", Nays: "no" }[sec.slice(0, sec.indexOf("</h3>"))] ?? "absent";
      for (const m of sec.matchAll(/<div>\s*(?:<a href="[^"]*\/members\/([^"]*)"[^>]*>|<span>)([^<]+)</g)) {
        const name = decodeXml(m[2]).trim();
        if (pos === "yes") yes++; else if (pos === "no") no++;
        const id = person(chamber, m[1], name);
        if (!id) { const k = `${chamber}:${name}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
        votes[id] = pos;
      }
    }
    if (!Object.keys(votes).length) { skip("no-matched-voters"); continue; }
    if (yes !== yea || no !== nay) tallyMismatch++;
    rolls[chamber].push({
      id: `oh-${b.number}-${chamber === "lower" ? "h" : "s"}-${day}-${seen[k]}`,
      number: b.number,
      bill: label(b.number),
      title: b.short_title,
      kind: classify({ motion_text: "", motion_classification: ["passage"] }), // floor rows on the Votes tab are passage/concurrence votes
      outcome: `${FLOOR_RESULT[result]} ${yea}–${nay}`, // official result, not yea > nay (2/3 emergency, 3/5 JR)
      date: day,
      dateLabel: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`,
      sourceUrl: `${SITE}/${b.number}/votes`,
      votes,
    });
  }
}

const PDFTXT = join(dirname(fileURLToPath(import.meta.url)), "pdf-text.py");
async function pdfText(url, name) {
  const txt = join(work, `${name}.txt`);
  if (existsSync(txt)) return readFileSync(txt, "utf8");
  const pdf = join(work, `${name}.pdf`);
  if (!existsSync(pdf)) {
    last = Math.max(last + 350, Date.now());
    if (last > Date.now()) await sleep(last - Date.now());
    await new Promise((resolve, reject) => execFile("curl", ["-skL", "--max-time", "60", "-o", pdf, url], (e) => (e ? reject(e) : resolve())));
  }
  const text = await new Promise((resolve) => execFile("python3", [PDFTXT, pdf], { maxBuffer: 64e6 }, (_, out) => resolve(out ?? "")));
  writeFileSync(txt, text);
  return text;
}
/** Opening bullets of an LSC analysis ("SUMMARY" / "Highlights" / "Synopsis") as plain sentences. */
function analysisSummary(text) {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const start = lines.findIndex((l) => /^(summary|highlights|synopsis)$/i.test(l));
  if (start < 0) return "";
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (/^[A-Z][A-Z ,&'’-]{3,}$/.test(l) || /^table of contents/i.test(l)) break;
    body.push(l);
  }
  const items = body.join(" ").split(/[▪•]/).map((x) => x.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/(\w) -(?=\w)/g, "$1-").trim()).filter(Boolean);
  return items.map((x) => (/[.!?]$/.test(x) ? x : `${x}.`)).join(" ");
}
const analyses = new Map(); // bill number -> { summary, summarySource }
for (const num of new Set(Object.values(rolls).flat().map((r) => r.number))) {
  const docs = await get(`${SITE}/${num}/documents`, `docs-${num}.html`);
  const sec = /<h2>Analysis<\/h2>([\s\S]*?)<\/section>/.exec(docs)?.[1] ?? "";
  const key = /download\?key=(\d+)/.exec(sec)?.[1]; // listed newest first: final analysis, else as passed, else as introduced
  if (!key) continue;
  analyses.set(num, billSummary({ title: "", abstracts: [{ abstract: analysisSummary(await pdfText(`https://www.legislature.ohio.gov/download?key=${key}`, `analysis-${num}-${key}`)) }] }));
}
console.log(`${analyses.size} bills with an analysis summary`);
for (const r of Object.values(rolls).flat()) Object.assign(r, analyses.get(r.number));

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  for (const r of list) delete r.number;
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-oh-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("oh", chamber),
    sourceLabel: `Roll call · Ohio ${chamber === "lower" ? "House" : "Senate"} floor votes (Ohio Legislature)`,
    keyBy: "openstates",
    jurisdiction: "oh",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.filter((r) => r.summary).length} with official summary`);
}
console.log("results:", results, "| skipped:", skipped, "| tally mismatches:", tallyMismatch);
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
