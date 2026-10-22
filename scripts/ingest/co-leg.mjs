/**
 * Colorado 2025 and 2026 Regular Session floor votes from the General Assembly's own site (https://leg.colorado.gov).
 * Replaces any sampled Open States files state-co-{lower,upper}.json with every House and Senate floor roll call
 * (second/third reading, repass, concur, ...; the bill page's "Votes" tab links committee votes separately and those
 * are not imported), plus the official bill summary from the bill page.
 *
 * Pages (server-rendered HTML, plain GET):
 *   /bills/{HB25-1001}      bill numbers are probed (the site search caps at 750 results); title, Bill Summary, /bill_votes/ links
 *   /bill_votes/{id}        chamber, calendar, motion, date, Yes/No/Absent/Excused counts, per-member vote by SURNAME
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/co.csv by chamber + surname (the
 * vote pages give surnames only; the site adds a first initial where two members of a chamber share one, "Stewart K.").
 * Order: current member of that chamber, then Open States' retired list, then a current member of the other chamber
 * (chamber switchers); a name that fits several people is dropped and reported rather than guessed. The Senate
 * "President" row is James Coleman (also listed by name from Jan 2026, then counted once). Simple resolutions (HR/SR) are omitted. Excused and Absent are
 * stored as "absent".
 *
 * Responses are cached in --work (default ~/.cache/co-leg); <= 3 requests/second. The site answers curl only with an
 * explicit Accept header.
 * Run: node scripts/ingest/co-leg.mjs [--work dir]
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
const SITE = "https://leg.colorado.gov";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHAMBER = { House: "lower", Senate: "upper" };
const POSITION = { Yes: "yes", No: "no", Absent: "absent", Excused: "absent" };

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/co-leg");
mkdirSync(work, { recursive: true });

let last = 0;
/** Cached GET returning HTML text (null on 404). */
async function get(path, name) {
  const file = join(work, name);
  if (existsSync(file)) return readFileSync(file, "utf8");
  for (let attempt = 0; ; attempt++) {
    last = Math.max(last + 1000, Date.now());
    const wait = last - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const body = await new Promise((resolve, reject) =>
        execFile("curl", ["-sL", "--max-time", "60", "-H", "Accept: text/html", "-A", "Mozilla/5.0 (thefullrecord-ingest; civic transparency)", "-w", "\n%{http_code}", `${SITE}${path}`],
          { maxBuffer: 64e6 }, (e, out) => (e ? reject(e) : resolve(out))));
      const code = body.slice(body.lastIndexOf("\n") + 1);
      const text = body.slice(0, body.lastIndexOf("\n"));
      if (code === "404") return null;
      if (code === "429") console.log(new Date().toISOString(), "429", path);
      if (code !== "200") throw new Error(`${path} -> ${code}`);
      writeFileSync(file, text);
      return text;
    } catch (e) {
      if (attempt >= 8) throw e;
      await sleep(15000 * (attempt + 1));
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

// --- Roster: Open States people (current, then retired) matched by surname (+ first initial, which the site adds
// when two members of a chamber share a surname, e.g. "Stewart K.").
const people = csv(await (await politeGet("https://data.openstates.org/people/current/co.csv")).text());
const cands = []; // { id, given, names: Set of normalised surname spellings, chamber (current members only) }
for (const p of people) cands.push({ id: p.id, given: norm(p.given_name), names: new Set([norm(p.family_name), norm(p.family_name.split(" ").at(-1))]), chamber: p.current_chamber }); // "Garcia Sander" is also written "Sander"
// Open States holds two retired records for Dafna Michaelson Jenet; the Senate one (2023-09 to 2026-02) is the Senate voter.
const OVERRIDE = { "upper:michaelsonjenet": "ocd-person/3818c80e-ca06-40d5-be21-ae570f6a21b5" };
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/co/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), names: new Set([norm(rest.join("")), norm(rest.at(-1) ?? "")]), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const unmatched = new Map(); const ambiguous = new Map();
/** Open States id for a vote-page name; null (and counted) when unknown or shared by several people. */
function person(chamber, label) {
  const m = /^(.*\S)\s+([A-Z])\.$/.exec(label.trim());
  const k = norm(m ? m[1] : label), initial = m?.[2].toLowerCase();
  if (OVERRIDE[`${chamber}:${k}`]) return OVERRIDE[`${chamber}:${k}`];
  const fits = cands.filter((c) => c.names.has(k) && (!initial || c.given[0] === initial));
  for (const stage of [fits.filter((c) => c.chamber === chamber), fits.filter((c) => !c.chamber), fits.filter((c) => c.chamber && c.chamber !== chamber)]) {
    const ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { ambiguous.set(`${chamber}:${label}`, (ambiguous.get(`${chamber}:${label}`) ?? 0) + 1); return null; }
  }
  return null;
}

// --- Bill list.
// The site's search stops after 750 results, so bill numbers are probed: House measures number from 1001, Senate from
// 001; 20 missing numbers in a row end a series. Missing numbers are remembered in missing.json.
const missingFile = join(work, "missing.json");
const missing = new Set(existsSync(missingFile) ? JSON.parse(readFileSync(missingFile, "utf8")) : []);
const bills = [];
for (const yy of ["25", "26"]) {
  for (const prefix of ["HB", "SB", "HJR", "SJR", "HCR", "SCR"]) {
    let gap = 0;
    for (let i = prefix[0] === "H" ? 1001 : 1; gap < 20; i++) {
      const bill = `${prefix}${yy}-${prefix[0] === "H" ? i : String(i).padStart(3, "0")}`;
      if (missing.has(bill)) { gap++; continue; }
      const page = await get(`/bills/${bill}`, `bill-${bill}.html`);
      if (!page) { missing.add(bill); gap++; continue; }
      gap = 0;
      bills.push([bill, page]);
    }
    writeFileSync(missingFile, JSON.stringify([...missing]));
  }
}
console.log(`${bills.length} bills found`);

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
let tallyMismatch = 0, n = 0;
const seen = new Set();
/** Bill history rows from the bill page ("Bill history" tab): { date: "YYYY-MM-DD", location, action }. */
function billHistory(page) {
  const i = page.indexOf("id=bill-histories");
  if (i < 0) return [];
  const table = page.slice(i, page.indexOf("</table>", i));
  return [...table.matchAll(/<tr class='mb-0'[\s\S]*?<\/tr>/g)].map((m) => {
    const cell = (k) => text(new RegExp(`data-label="${k}">([\\s\\S]*?)<\\/td>`).exec(m[0])?.[1] ?? "");
    const d = /(\d\d)\/(\d\d)\/(\d{4})/.exec(cell("Date"));
    return { date: d ? `${d[3]}-${d[1]}-${d[2]}` : "", location: cell("Location"), action: cell("Action") };
  });
}

/**
 * Whether a floor vote carried. The vote page prints only the tally, so for a third-reading vote on the measure itself
 * the official result is taken from the bill history ("Senate Third Reading Lost - No Amendments" /
 * "House Third Reading Passed - ..."), same chamber and date. Only when the history gives no single result is a
 * threshold applied: Colo. Const. Art. V §22 (a bill passes only by "a majority of all members elected to each
 * house": 33 of 65 House, 18 of 35 Senate) and Art. XIX §2 (a concurrent resolution referring a constitutional
 * amendment needs two-thirds of the members elected to each house: 44 / 24). Other motions: more yes than no.
 */
function votePassed({ chamber, day, motion, calendar, yea, nay, history }) {
  // A record with no Yes or No at all (the site lists some as 0-0 with every member Absent, beside the real vote of
  // the same day) did not carry, whatever the history says about that day's other vote.
  if (yea + nay === 0) return false;
  const finalVote = /third reading/i.test(calendar) && /^(bill|concurrent resolution)$/i.test(motion);
  if (finalVote) {
    const house = chamber === "lower" ? "House" : "Senate";
    const verdicts = new Set(history
      .filter((h) => h.date === day && h.location === house)
      .map((h) => new RegExp(`^${house} Third Reading (Passed|Lost|Failed)\\b`).exec(h.action)?.[1])
      .filter(Boolean));
    if (verdicts.size === 1) return [...verdicts][0] === "Passed";
    const elected = chamber === "lower" ? 65 : 35;
    const need = /^concurrent resolution$/i.test(motion) ? Math.ceil((elected * 2) / 3) : Math.floor(elected / 2) + 1;
    return yea > nay && yea >= need;
  }
  return yea > nay;
}

for (const [bill, page] of bills) {
  if (++n % 200 === 0) console.log(`${n}/${bills.length} bills`);
  const voteIds = [...new Set([...page.matchAll(/\/bill_votes\/(\d+)/g)].map((m) => m[1]))];
  if (!voteIds.length) continue;
  const title = text(/<h1>([\s\S]*?)<\/h1>/.exec(page)?.[1] ?? "");
  const longTitle = text(/<p class=["']bill-long-title[^>]*>([\s\S]*?)<\/p>/.exec(page)?.[1] ?? "");
  const rawSummary = /<div class=["']bill-summary-content["']>([\s\S]*?)<\/div>/.exec(page)?.[1] ?? "";
  const { summary, summarySource } = billSummary({ title, abstracts: [{ abstract: text(rawSummary) }] });
  const history = billHistory(page);
  for (const vid of voteIds) {
    if (seen.has(vid)) continue;
    seen.add(vid);
    const v = await get(`/bill_votes/${vid}`, `vote-${vid}.html`);
    if (!v) { skip("vote-404"); continue; }
    const chamber = CHAMBER[/fa-landmark-dome[^>]*>\s*<\/i><\/span>\s*(House|Senate)/.exec(v)?.[1]];
    const dm = /(\d\d)\/(\d\d)\/(\d{4})/.exec(/Voted on[\s\S]*?<td[^>]*data-label="Voted on">([\s\S]*?)<\/td>/.exec(v)?.[1] ?? "");
    if (!chamber || !dm) { skip("bad-chamber-or-date"); continue; }
    const day = `${dm[3]}-${dm[1]}-${dm[2]}`;
    const count = (k) => Number(new RegExp(`count-tag ${k}">\\s*(\\d+)`).exec(v)?.[1] ?? 0);
    const yea = count("Yes"), nay = count("No");
    const motion = text(/data-label="Motion">([\s\S]*?)<\/td>/.exec(v)?.[1] ?? "");
    const calendar = text(/data-label="Calendar">([\s\S]*?)<\/td>/.exec(v)?.[1] ?? "");
    const votes = {}; let yes = 0, no = 0;
    const list = v.slice(v.indexOf("Votes by "));
    for (const m of list.matchAll(/<td>([^<]+)<\/td>\s*<td class="text-right">[\s\S]*?class="vote-tag (\w+)">/g)) {
      const pos = POSITION[m[2]];
      if (!pos) continue;
      const raw = decodeXml(m[1]).trim();
      // The Senate President (James Coleman, 2025-26) is listed by title; from Jan 2026 the page lists him by name too.
      if (chamber === "upper" && raw === "President" && list.includes("<td>Coleman</td>")) continue;
      const name = chamber === "upper" && raw === "President" ? "Coleman" : raw;
      if (pos === "yes") yes++; else if (pos === "no") no++;
      const id = person(chamber, name);
      if (!id) { const k = `${chamber}:${name}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
      votes[id] = pos;
    }
    if (!Object.keys(votes).length) { skip("no-matched-voters"); continue; }
    if (yes !== yea || no !== nay) tallyMismatch++;
    const question = [motion, calendar && `(${calendar})`].filter(Boolean).join(" ") || undefined;
    rolls[chamber].push({
      id: `co-${vid}`,
      bill: bill,
      title: title || longTitle,
      ...(summary ? { summary, summarySource } : {}),
      question,
      kind: classify({ motion_text: `${motion} ${calendar}`, motion_classification: /third reading|repass|concur|final passage|adopt|passage/i.test(`${motion} ${calendar}`) ? ["passage"] : [] }),
      outcome: `${votePassed({ chamber, day, motion, calendar, yea, nay, history }) ? "Passed" : "Failed"} ${yea}–${nay}`,
      date: day,
      dateLabel: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`,
      sourceUrl: `${SITE}/bills/${bill}`,
      votes,
    });
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-co-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("co", chamber),
    sourceLabel: `Roll call · Colorado ${chamber === "lower" ? "House" : "Senate"} floor votes (Colorado General Assembly)`,
    keyBy: "openstates",
    jurisdiction: "co",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.filter((r) => r.summary).length} with official summary`);
}
console.log("skipped:", skipped, "| tally mismatches:", tallyMismatch);
console.log("ambiguous surnames (votes dropped):", Object.fromEntries(ambiguous));
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
