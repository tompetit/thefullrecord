/**
 * Arkansas 2025 Regular and 2026 Fiscal Session floor votes from the General Assembly's own site (https://arkleg.state.ar.us).
 * Replaces any sampled Open States files state-ar-{lower,upper}.json with every House and Senate floor roll call that the
 * bill history links ("House Votes" / "Senate Votes"; committee votes are not linked there and are not imported).
 *
 * Pages (server-rendered HTML, plain GET, robots.txt allows all):
 *   /Bills/Detail?id=HB1001&ddBienniumSession=2025%2F2025R   bill history; each vote row has a /Bills/Votes?id=..&rcs=..&chamber=.. link
 *   /Bills/Votes?id=HB1001&rcs=29&chamber=House&...          date/time, title, Yeas/Nays/Non Voting/Present/Excused with member names
 * Bill numbers are probed (HB/SB/HJR/SJR/HCR/SCR; 30 missing in a row end a series) because the site has no bulk list.
 * Members are keyed "ocd-person/<uuid>" via Open States' ar.csv: the vote page's member name ("A. Clark", "Beaty Jr.") is the
 * `Legislators/Detail?member=` value that Open States stores in each member's sources; otherwise chamber + surname (+ initial)
 * against current then retired members. A name that fits several people is dropped and reported. Simple resolutions (HR/SR)
 * are omitted. Non Voting and Excused are stored as "absent". The page publishes no bill summary, so none is stored.
 *
 * Responses are cached in --work (default ~/.cache/ar-leg); <= 3 requests/second.
 * Run: node scripts/ingest/ar-leg.mjs [--work dir]
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
const SITE = "https://arkleg.state.ar.us";
const SESSIONS = [["2025/2025R", "25R"], ["2025/2026F", "26F"]];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CHAMBER = { House: "lower", Senate: "upper" };
const POSITION = { Yeas: "yes", Nays: "no", "Non Voting": "absent", Excused: "absent", Present: "present" };

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/ar-leg");
mkdirSync(work, { recursive: true });

let last = 0;
/** Cached GET returning HTML text. */
async function get(path, name) {
  const file = join(work, name);
  if (existsSync(file)) return readFileSync(file, "utf8");
  for (let attempt = 0; ; attempt++) {
    last = Math.max(last + 350, Date.now());
    const wait = last - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const body = await new Promise((resolve, reject) =>
        execFile("curl", ["-sL", "--max-time", "60", "-A", "Mozilla/5.0 (thefullrecord-ingest; civic transparency)", "-w", "\n%{http_code}", `${SITE}${path}`],
          { maxBuffer: 64e6 }, (e, out) => (e ? reject(e) : resolve(out))));
      const code = body.slice(body.lastIndexOf("\n") + 1);
      if (code !== "200") throw new Error(`${path} -> ${code}`);
      const text = body.slice(0, body.lastIndexOf("\n"));
      writeFileSync(file, text);
      return text;
    } catch (e) {
      if (attempt >= 8) throw e;
      await sleep(15000 * (attempt + 1));
    }
  }
}
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const SUFFIX = /\s+(jr|sr|ii|iii|iv)\.?$/i;
const surname = (s) => norm(s.replace(SUFFIX, ""));
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
const people = csv(await (await politeGet("https://data.openstates.org/people/current/ar.csv")).text());
const cands = []; // { id, given, names, chamber (current members only) }
const bySite = new Map(); // arkleg member= value + chamber -> id
for (const p of people) {
  cands.push({ id: p.id, given: norm(p.given_name), names: new Set([surname(p.family_name), surname(p.family_name.split(" ").at(-1))]), chamber: p.current_chamber });
  for (const u of `${p.sources};${p.links}`.split(";")) {
    const m = /arkleg\.state\.ar\.us\/Legislators\/Detail\?member=([^&]+)/i.exec(u);
    if (m) bySite.set(norm(decodeURIComponent(m[1].replace(/\+/g, " "))) + ":" + p.current_chamber, p.id);
  }
}
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/ar/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), names: new Set([norm(rest.join("")), norm(rest.at(-1) ?? "")]), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const unmatched = new Map(); const ambiguous = new Map();
// Open States holds two retired records for Gary Stubblefield; the 2023-2026 term (district 26) is the 2025-26 voter.
const OVERRIDE = { "upper:garystubblefield": "ocd-person/b4087806-94ad-43fd-b4a1-31a4f923bf2f" };
function person(chamber, label) {
  if (label === "G. Stubblefield" && chamber === "upper") return OVERRIDE["upper:garystubblefield"];
  const direct = bySite.get(norm(label) + ":" + chamber);
  if (direct) return direct;
  const m = /^([A-Z])\.\s+(.+)$/.exec(label.trim());
  const k = surname(m ? m[2] : label), initial = m?.[1].toLowerCase();
  const fits = cands.filter((c) => c.names.has(k) && (!initial || c.given[0] === initial));
  for (const stage of [fits.filter((c) => c.chamber === chamber), fits.filter((c) => !c.chamber), fits.filter((c) => c.chamber && c.chamber !== chamber)]) {
    const ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { ambiguous.set(`${chamber}:${label}`, (ambiguous.get(`${chamber}:${label}`) ?? 0) + 1); return null; }
  }
  return null;
}

// --- Bill list: probe numbers per series (House series start at 1001, Senate at 1).
const bills = []; // { session, code, id, page }
for (const [session, code] of SESSIONS) {
  const missingFile = join(work, `missing-${code}.json`);
  const missing = new Set(existsSync(missingFile) ? JSON.parse(readFileSync(missingFile, "utf8")) : []);
  for (const prefix of ["HB", "SB", "HJR", "SJR", "HCR", "SCR"]) {
    let gap = 0;
    for (let i = prefix[0] === "H" ? 1001 : 1; gap < 30; i++) {
      const id = `${prefix}${i}`;
      if (missing.has(id)) { gap++; continue; }
      const page = await get(`/Bills/Detail?id=${id}&ddBienniumSession=${encodeURIComponent(session)}`, `bill-${code}-${id}.html`);
      if (!page.includes("Bill Number:")) { missing.add(id); gap++; continue; }
      gap = 0;
      bills.push({ session, code, id, page });
    }
    writeFileSync(missingFile, JSON.stringify([...missing]));
  }
  console.log(code, "bills so far:", bills.length);
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
let n = 0;
const seen = new Set();
for (const { code, id: bill, page } of bills) {
  if (++n % 200 === 0) console.log(`${n}/${bills.length} bills`);
  // History rows: chamber | date | action | links
  for (const row of page.split(/class="row tableRow(?:Alt)?"/).slice(1)) {
    const link = /href="(\/Bills\/Votes\?id=[^"]*?(?:&amp;|&)rcs=(\d+)(?:&amp;|&)chamber=(House|Senate)[^"]*)"/.exec(row);
    if (!link) continue;
    const [, href, rcs, chamberName] = link;
    const key = `${code}|${chamberName}|${rcs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const action = text(/aria-colindex="3"[^>]*>([\s\S]*?)<\/div>/.exec(row)?.[1] ?? "");
    const url = href.replace(/&amp;/g, "&");
    const v = await get(url, `vote-${code}-${chamberName[0]}${rcs}.html`);
    const head = /<h1>(House|Senate) Vote - \w+, (\w+) (\d+), (\d{4})/.exec(v);
    const mi = head ? MONTHS.indexOf(head[2]) : -1;
    if (!head || mi < 0) { skip("bad-date"); continue; }
    const chamber = CHAMBER[head[1]];
    const day = `${head[4]}-${String(mi + 1).padStart(2, "0")}-${String(head[3]).padStart(2, "0")}`;
    const title = text(new RegExp(`>\\s*${bill} - ([^<]*)<`).exec(v)?.[1] ?? "").trim();
    // Sections: <b ...>Yeas: 99</b> followed by the member grid.
    const votes = {}; const printed = {}, parsed = {};
    const parts = v.split(/<b style="font-size:23px;">(Yeas|Nays|Non Voting|Present|Excused): (\d+)<\/b>/);
    for (let i = 1; i < parts.length; i += 3) {
      const [label, count, body] = [parts[i], Number(parts[i + 1]), parts[i + 2].split("<script>")[0]];
      const names = [...body.matchAll(/Legislators\/Detail\?member=[^>]*>\s*([^<]+?)\s*<\/a>/g)].map((m) => decodeXml(m[1]));
      printed[label] = count; parsed[label] = names.length;
      for (const name of names) {
        const pid = person(chamber, name);
        if (!pid) { const k = `${chamber}:${name}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
        votes[pid] = POSITION[label];
      }
    }
    if (Object.keys(printed).length < 3 || !Object.keys(votes).length) { skip("no-voters"); continue; }
    // Tally check: parsed member names per section must equal the printed counts.
    if (Object.keys(printed).some((k) => printed[k] !== parsed[k])) { skip("tally-mismatch"); continue; }
    const yea = printed.Yeas, nay = printed.Nays;
    const failed = /\b(fail|lost|not (pass|adopt|concur))/i.test(action);
    const passed = /\b(pass|adopt|concur|agree|approv)/i.test(action);
    rolls[chamber].push({
      id: `ar-${code}-${chamberName[0]}${rcs}`,
      bill,
      title: title || bill,
      question: action || undefined,
      kind: classify({ motion_text: action, motion_classification: /pass|adopt|concur/i.test(action) ? ["passage"] : [] }),
      outcome: `${failed ? "Failed" : passed || yea > nay ? "Passed" : "Failed"} ${yea}–${nay}`,
      date: day,
      dateLabel: `${MONTHS[mi].slice(0, 3)} ${Number(head[3])}, ${head[4]}`,
      sourceUrl: `${SITE}${url}`,
      votes,
    });
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-ar-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("ar", chamber),
    sourceLabel: `Roll call · Arkansas ${chamber === "lower" ? "House" : "Senate"} floor votes (Arkansas General Assembly)`,
    keyBy: "openstates",
    jurisdiction: "ar",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.at(-1)?.date} to ${list[0]?.date}`);
}
console.log("skipped:", skipped);
console.log("ambiguous names (votes dropped):", Object.fromEntries(ambiguous));
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
