/**
 * Ohio 136th General Assembly (2025-26) floor votes from the Legislature's own site
 * (https://www.legislature.ohio.gov). Replaces the sampled Open States files state-oh-{lower,upper}.json with every
 * House and Senate recorded floor vote shown on a bill's "Votes" tab (passage, concurrence, ...; committee votes are
 * not on that tab).
 *
 * Sources:
 *   search-prod.lis.state.oh.us/api/v2/general_assembly_136/legislation/   every bill + short_title (one request)
 *   www.legislature.ohio.gov/legislation/136/{bill}/votes                   server-rendered HTML: date, chamber,
 *       per-member Yeas / Nays lists (name, party, link to the member's page)
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/oh.csv: first by the member-page
 * slug (the CSV's ohiohouse.gov/ohiosenate.gov member links), then by chamber + name; former members fall back to
 * Open States' retired list on full name. Simple resolutions (HR/SR) are omitted. The Votes tab carries no motion text
 * and no absentee list, so `question` is omitted and only recorded Yeas/Nays are stored.
 * No bill summary: Ohio's LSC bill analyses are PDFs only (not in the API), so summaries are omitted.
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
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

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
const skipped = {}; let tallyMismatch = 0, n = 0;
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
    const k = `${chamber}-${day}`; seen[k] = (seen[k] ?? 0) + 1;
    rolls[chamber].push({
      id: `oh-${b.number}-${chamber === "lower" ? "h" : "s"}-${day}-${seen[k]}`,
      bill: label(b.number),
      title: b.short_title,
      kind: classify({ motion_text: "", motion_classification: ["passage"] }), // the Votes tab lists passage/concurrence votes only
      outcome: `${yea > nay ? "Passed" : "Failed"} ${yea}–${nay}`,
      date: day,
      dateLabel: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`,
      sourceUrl: `${SITE}/${b.number}/votes`,
      votes,
    });
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
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
  console.log(`${chamber}: ${list.length} roll calls`);
}
console.log("skipped:", skipped, "| tally mismatches:", tallyMismatch);
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
