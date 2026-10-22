/**
 * Minnesota 94th Legislature (2025-26, plus the 2025 First Special Session) floor roll calls, both chambers.
 *
 * House: the House's own vote pages (https://www.house.mn.gov/votes/). The page scripts post {SessionKey, sortOption}
 * to /Votes/GetVoteSummary (public JSON: bill number + short description of every bill with a recorded roll call) and
 * each bill's /Votes/Details?SessionKey=&BillNumber= page is server-rendered: one panel per roll call with the motion,
 * printed Yeas/Nays tally, journal page, date and the Yea and Nay name lists. SessionKey 302 = 2025-2026 regular
 * sessions, 304 = 2025 special session.
 * Senate: no vote pages exist, so the daily Senate Journal PDFs (https://www.senate.mn/journals/journal_list.php?
 * display_ls_year=94) are parsed: every "The roll was called, and there were yeas N and nays M, as follows:" block
 * lists the affirmative and negative senators by surname. Text is extracted with pdf-fulltext.py (pypdf).
 *
 * Neither chamber's page lists absent members, so absent is INFERRED: a member who has recorded votes in the chamber
 * and does not appear in a roll call dated inside the span of his or her recorded votes (widened to the whole
 * session for members whose first/last vote falls within 14 days of the chamber's first/last roll call) is stored
 * as "absent". A roll call is kept only when the parsed Yea/Nay names equal the printed tally.
 * Members: Open States people (current CSV + retired list) matched by chamber + surname (+ initials the House
 * prints for shared surnames, "Anderson, P. H.").
 *
 * Cache in --work (default ~/.cache/mn-leg); <= 2.5 requests/second. Needs pypdf: PYTHONPATH=/path/to/pypdf.
 * Run: node scripts/ingest/mn-leg.mjs [--work dir]
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, sleep, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../src/server/snapshot");
const HOUSE = "https://www.house.mn.gov";
const SENATE = "https://www.senate.mn";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/mn-leg");
for (const d of ["", "house", "hj", "rev", "sj", "sjtxt"]) mkdirSync(join(work, d), { recursive: true });

const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const text = (html) => decodeXml(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const stripZw = (s) => s.replace(/[​‌‍﻿]/g, "").trim();
const label = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
const sentence = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// --- Roster (Open States) ------------------------------------------------------------------------------------
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
const people = csv(await (await politeGet("https://data.openstates.org/people/current/mn.csv")).text());
const cands = []; // { id, given, names, chamber } (chamber null = retired)
for (const p of people) cands.push({ id: p.id, given: norm(p.given_name), names: new Set([norm(p.family_name), norm(p.family_name.split(" ").at(-1))]), chamber: p.current_chamber });
try {
  // MN_RETIRED_DIR: a local checkout of openstates/people data/mn/retired, for when the GitHub API is unreachable.
  const listing = process.env.MN_RETIRED_DIR ? readdirSync(process.env.MN_RETIRED_DIR).map((name) => ({ name }))
    : await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/mn/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), names: new Set([norm(rest.join("")), norm(rest.at(-1) ?? "")]), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const byGiven = (given) => people.find((p) => p.given_name === given)?.id;
// The House prints middle initials for the two Andersons: Paul H. Anderson (12A, Starbuck) and Patti E. Anderson (33A).
const OVERRIDE = {
  "lower:andersonpe": people.find((p) => p.family_name === "Anderson" && p.given_name === "Patti")?.id,
  "lower:leek": people.find((p) => p.family_name === "Lee" && p.given_name === "Liz")?.id, // Fue = F., Xp = X.
  "lower:momanyihiltsley": people.find((p) => p.family_name === "Hiltsley")?.id,
  "upper:anderson": cands.find((c) => c.id === "ocd-person/63ed97bf-edfa-44d2-9259-9ac1799dfea6")?.id, // Bruce D. Anderson (retired in 2025)
  "lower:andersonph": people.find((p) => p.family_name === "Anderson" && p.given_name === "Paul")?.id,
};
const MULTI = new Set(people.map((p) => p.family_name).filter((f) => f.includes(" ")).flatMap((f) => [f]));
const unmatched = new Map(), ambiguous = new Map();
const cache = new Map();
/** Open States id for a printed name ("Surname" or "Surname, I. J."); null (counted) when unknown or ambiguous. */
function person(chamber, raw) {
  const key = `${chamber}:${raw}`;
  if (cache.has(key)) return cache.get(key);
  const [surname, initials = ""] = raw.split(",").map((s) => s.trim());
  const k = norm(surname), ini = norm(initials);
  let id = null;
  if (OVERRIDE[`${chamber}:${k}${ini}`]) id = OVERRIDE[`${chamber}:${k}${ini}`];
  else {
    const fits = cands.filter((c) => c.names.has(k) && (!ini || c.given[0] === ini[0]));
    for (const stage of [fits.filter((c) => c.chamber === chamber), fits.filter((c) => !c.chamber), fits.filter((c) => c.chamber && c.chamber !== chamber)]) {
      const ids = [...new Set(stage.map((c) => c.id))];
      if (ids.length === 1) { id = ids[0]; break; }
      if (ids.length > 1) { ambiguous.set(key, 1); break; }
    }
  }
  cache.set(key, id);
  return id;
}

// --- Fetching ------------------------------------------------------------------------------------------------
let last = 0;
async function pace() { last = Math.max(last + 400, Date.now()); const w = last - Date.now(); if (w > 0) await sleep(w); }
async function getText(url, file, init) {
  if (existsSync(file)) return readFileSync(file, "utf8");
  await pace();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000), headers: { "User-Agent": "thefullrecord-ingest/1.0 (civic transparency)", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const body = await res.text();
  writeFileSync(file, body);
  return body;
}

const rolls = { lower: [], upper: [] };
// Appeals of rulings, tabling, suspending the rules, previous question etc. are procedural even when they sit on a bill.
const PROC = /appeal|decision of (the )?(President|Speaker|Chair)|judgment of the (Senate|House)|germane|ruling|\btable\b|suspen(d|sion)|previous question|call of the (Senate|House)|reconsider|re-?referr?(ed|al)|point of order|recall and|calendar for the day|take from the table|lay on the table/i;
const dropped = {}; const drop = (chamber, why) => { const k = `${chamber}:${why}`; dropped[k] = (dropped[k] ?? 0) + 1; };

// --- House ---------------------------------------------------------------------------------------------------
const houseTitles = new Map(); // "HF 719" -> official short description
const normBill = (n) => n.replace(/^([A-Z]+)0*(\d+)$/, "$1 $2");

// The vote pages give no result, and "more yeas than nays" is wrong for questions that need a fixed number of votes
// (final passage and Rule 1.21 Calendar-for-the-Day motions: 68 = a majority of the 134 members; suspension of the
// rules: two-thirds). The result is therefore read from the House Journal: the vote page's journal page number is
// mapped to the daily journal file by the page's own /Votes/GetPage call, and the first result sentence after the
// roll call with the same printed tally on that page ("The motion did not prevail", "The bill was passed", "not
// having received the required 68 votes") decides. Falls back to yeas > nays (counted) when no sentence is found.
const journalFile = new Map(); // `${sessionKey}:${page}` -> "2025-26/J0511072"
const journalText = new Map(); // file -> flattened text with "@@P<page>@@" markers
const journalSession = new Map(); // file -> SessionKey
const pageMapFile = join(work, "house-journal-pages.json");
const pageMap = existsSync(pageMapFile) ? JSON.parse(readFileSync(pageMapFile, "utf8")) : {};
async function houseJournal(sessionKey, page, date) {
  const key = `${sessionKey}:${page}`;
  if (!pageMap[key]) {
    // A journal already loaded for this session usually holds the page; ask GetPage only otherwise.
    const known = [...journalText].find(([f, t]) => journalSession.get(f) === sessionKey && t.includes(`@@P${page}@@`))?.[0];
    if (known) pageMap[key] = known;
    for (let attempt = 0; !pageMap[key]; attempt++) {
      await pace();
      const res = await fetch(`${HOUSE}/Votes/GetPage`, { method: "POST", signal: AbortSignal.timeout(60_000), headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": "thefullrecord-ingest/1.0 (civic transparency)" }, body: JSON.stringify({ SessionKey: sessionKey, PageNumber: Number(page) }) });
      const body = res.ok ? await res.text() : "";
      if (body.startsWith("{")) { const { folder, fileName } = JSON.parse(body); pageMap[key] = `${folder}/${fileName}`; break; }
      if (attempt >= 2) {
        // GetPage answers a few pages with an error page: try the regular-session journals of the vote's date
        // (the journal list names files J<MMDD><legislative day>).
        if (sessionKey === 302 && date) {
          const index = await getText(`${HOUSE}/cco/journals/journl.htm`, join(work, "house-journal-index.html"));
          for (const [, f] of index.matchAll(/journals\/(2025-26\/J\d{7})\.htm/g)) {
            if (f.slice(9, 13) !== `${date.slice(5, 7)}${date.slice(8, 10)}`) continue;
            const html = await getText(`${HOUSE}/cco/journals/${f}.htm`, join(work, "hj", `${f.replace("/", "_")}.htm`));
            if (new RegExp(`<a name\\s*=\\s*"?${page}"?\\s*>`, "i").test(html)) { pageMap[key] = f; break; }
          }
          if (pageMap[key]) break;
        }
        console.warn(`GetPage ${key} -> ${res.status} (not JSON)`); return null;
      }
      await sleep(2000 * 2 ** attempt);
    }
    writeFileSync(pageMapFile, JSON.stringify(pageMap));
  }
  const file = pageMap[key];
  if (!journalText.has(file)) {
    const html = await getText(`${HOUSE}/cco/journals/${file}.htm`, join(work, "hj", `${file.replace("/", "_")}.htm`));
    journalSession.set(file, sessionKey);
    journalText.set(file, decodeXml(html.replace(/<a name\s*=\s*"?(\d+)"?\s*>/gi, " @@P$1@@ ")).replace(/[ Â]/g, " ").replace(/\s+/g, " "));
  }
  return journalText.get(file);
}
const RESULT = /did not prevail|was not (passed|adopted|repassed|sustained)|not having received|should not stand|did not stand|motion failed|(motion|it) prevailed|was (passed|repassed|adopted)|should stand|was sustained/i;
// The question named in the journal sentence that puts the vote must fit the vote page's motion (several roll calls on
// one page often share a tally, e.g. 67-66).
const QUESTION_FIT = [
  [/decision|judgment/i, /stand as the judgment/i], [/suspen/i, /suspen/i], [/reconsider/i, /reconsider/i],
  [/table/i, /table/i], [/calendar for the day/i, /Calendar for the Day/i], [/call of the house/i, /call of the House/i],
  [/re-?refer|recall/i, /refer|recall|General Register/i], [/amendment/i, /amendment/i], [/passage/i, /passage/i],
];
const usedTally = new Set();
/** true/false from the journal sentence after the roll call, or null when it can't be found. */
async function houseResult(sessionKey, page, yea, nay, motion, date) {
  const fit = QUESTION_FIT.find(([m]) => m.test(motion))?.[1];
  if (!/^\d+$/.test(page)) return null;
  const t = await houseJournal(sessionKey, page, date);
  if (!t) return null;
  const start = Math.max(0, t.indexOf(`@@P${Number(page) - 1}@@`)); // a roll call can begin at the foot of the previous page
  let end = t.indexOf(`@@P${Number(page) + 2}@@`, start);
  if (end < 0) end = Math.min(t.length, start + 60_000);
  const re = new RegExp(`There were ${yea} yeas? and ${nay} nays?`, "g");
  re.lastIndex = start;
  const cands = [];
  for (let m; (m = re.exec(t)) && m.index < end;) {
    const k = `${pageMap[`${sessionKey}:${page}`]}:${m.index}`;
    if (!usedTally.has(k)) cands.push({ m, k, put: t.slice(Math.max(0, m.index - 1500), m.index).split("as follows:").at(-1) }); // back to the previous roll call
  }
  // Same tally twice in reach: take the one whose question fits the vote page's motion.
  const pick = (cands.length > 1 && fit && cands.find((c) => fit.test(c.put))) || cands[0];
  if (!pick) return null;
  usedTally.add(pick.k);
  const after = t.slice(pick.m.index + pick.m[0].length).replace(/@@P\d+@@ Journal Of the House[^@]*?Top of Page \d+/g, " ");
  const r = RESULT.exec(after.slice(0, 6000).split(/There were \d+ yeas? and/)[0]);
  if (!r) return null;
  return !/not|did not|failed/i.test(r[0]);
}
const motionCase = (s) => sentence(s.toLowerCase()).replace(/\b([hs])\.f\.(\s*no\.)?/gi, (_, c, no) => `${c.toUpperCase()}.F.${no ? " No." : ""}`)
  .replace(/calendar for the day/g, "Calendar for the Day")
  .replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|january|february|march|april|may(?= \d)|june|july|august|september|october|november|december)\b/g, (w) => sentence(w));
for (const [sessionKey, sessionLabel] of [[302, "2025-2026 Regular"], [304, "2025 Special"]]) {
  const summary = JSON.parse(await getText(`${HOUSE}/Votes/GetVoteSummary`, join(work, `house-summary-${sessionKey}.json`), {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ SessionKey: sessionKey, sortOption: "BillNumber" }),
  }));
  console.log(`House ${sessionLabel}: ${summary.length} bills with recorded roll calls`);
  for (const { Number: number, ShortDescription } of summary) {
    houseTitles.set(normBill(number), ShortDescription);
    const page = await getText(`${HOUSE}/Votes/Details?SessionKey=${sessionKey}&BillNumber=${number}`, join(work, "house", `${sessionKey}-${number}.html`));
    const sourceUrl = `${HOUSE}/Votes/Details?SessionKey=${sessionKey}&BillNumber=${number}`;
    const seenDay = {};
    for (const panel of page.split('class="collapsible-panel"').slice(1)) {
      const row = /<tbody>\s*<tr>([\s\S]*?)<\/tr>/.exec(panel)?.[1] ?? "";
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      if (cells.length < 7) { drop("lower", "bad-panel"); continue; }
      const lines = cells[1].split(/<br\s*\/?>/i).map((s) => text(s)).filter(Boolean); // "H.F. NO. 719", order of business, motion
      // Calendar-for-the-Day motions are printed as motion line, order of business, rest of the motion (no "H.F. NO." line):
      // "TO CONSIDER FIRST FOR CALENDAR" / "MOTIONS AND RESOLUTIONS" / "FOR THE DAY H.F. 3658".
      // Put them back in the usual order: "", order of business, motion.
      if (lines.length > 2 && !/^[HS]\.F\. NO\. \d+$/i.test(lines[0])) lines.splice(0, 3, "", lines[1], `${lines[0]} ${lines[2]}`);
      const amendment = text(cells[2]);
      const yea = Number(text(cells[3])), nay = Number(text(cells[4]));
      const dm = /(\d\d)\/(\d\d)\/(\d{4})/.exec(text(cells[6]));
      if (!dm || !Number.isFinite(yea) || !Number.isFinite(nay)) { drop("lower", "bad-date-or-tally"); continue; }
      const date = `${dm[3]}-${dm[1]}-${dm[2]}`;
      const lists = [...panel.matchAll(/Those who voted in the (affirmative|negative) were:[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/g)]
        .map((m) => [m[1], [...m[2].matchAll(/<td>([^<]+)/g)].map((c) => decodeXml(c[1]).trim()).filter(Boolean)]);
      const names = Object.fromEntries(lists);
      const yes = names.affirmative ?? [], no = names.negative ?? [];
      if (yes.length !== yea || no.length !== nay) { drop("lower", "tally-mismatch"); continue; }
      const votes = {}; let bad = false;
      for (const [pos, list] of [["yes", yes], ["no", no]]) for (const n of list) {
        const id = person("lower", n);
        if (!id) { unmatched.set(`lower:${n}`, (unmatched.get(`lower:${n}`) ?? 0) + 1); bad = true; continue; }
        votes[id] = pos;
      }
      if (bad) { drop("lower", "unmatched-member"); continue; }
      seenDay[date] = (seenDay[date] ?? 0) + 1;
      const rawMotion = lines.slice(2).join(" ");
      const motion = lines[0] ? rawMotion : motionCase(rawMotion);
      const question = [motion, lines[1] && `(${lines[1].toLowerCase().replace(/^./, (c) => c.toUpperCase())})`, amendment && `Amendment ${amendment}`].filter(Boolean).join(" ");
      const bill = normBill(number);
      const journalResult = await houseResult(sessionKey, text(cells[5]), yea, nay, `${motion} ${amendment}`, date);
      if (journalResult === null) { drop("lower", "result-not-in-journal (yeas > nays used)"); if (process.env.MN_DEBUG) console.error("NO RESULT", number, date, text(cells[5]), yea, nay, motion, amendment); }
      const passedH = journalResult ?? yea > nay;
      rolls.lower.push({
        id: `mn-h-${number}-${date.replaceAll("-", "")}-${seenDay[date]}`,
        bill,
        title: ShortDescription || bill,
        question: question || undefined,
        kind: PROC.test(`${motion} ${amendment}`) ? "procedural" : classify({ motion_text: `${motion} ${amendment}`, motion_classification: /passage|concur|conference/i.test(motion) && !amendment ? ["passage"] : [] }),
        outcome: `${passedH ? "Passed" : "Failed"} ${yea}–${nay}`,
        date, dateLabel: label(date), sourceUrl, votes,
      });
    }
  }
}

// --- Senate --------------------------------------------------------------------------------------------------
const list = await getText(`${SENATE}/journals/journal_list.php?display_ls_year=94`, join(work, "senate-journal-list.html"));
const journals = [...new Set([...list.matchAll(/\/journals\/\/2025-2026\/([^"']+\.pdf)/g)].map((m) => m[1]))]
  .filter((f) => !/index|comsub|Preamble|misc/i.test(f)).sort();
console.log(`Senate: ${journals.length} journal files`);
const senateTitles = new Map(); // "SF 2077" / "HF 3629" -> bill title phrase from the journal
const senateRolls = [];
const NAME = /^[A-Z][A-Za-z'’\-]+( [A-Z][A-Za-z'’\-]+)*$/;
const isHeader = (l) => /JOURNAL OF THE SENATE|^\[?\d+(ST|ND|RD|TH) DAY|^\d{4,5}$|^\d*[A-Z]{3,9}DAY, [A-Z]+ \d{1,2}, \d{4}/.test(l);

for (const file of journals) {
  const date = /^(\d{4})(\d\d)(\d\d)/.exec(file).slice(1).join("-");
  const txtFile = join(work, "sjtxt", file.replace(/\.pdf$/, ".txt"));
  if (!existsSync(txtFile)) {
    const pdf = join(work, "sj", file);
    if (!existsSync(pdf)) {
      await pace();
      const res = await fetch(`${SENATE}/journals//2025-2026/${file}`, { signal: AbortSignal.timeout(180_000), headers: { "User-Agent": "thefullrecord-ingest/1.0 (civic transparency)" } });
      if (!res.ok) throw new Error(`${file} -> ${res.status}`);
      writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
    }
    await run("python3", [join(HERE, "pdf-fulltext.py"), pdf, txtFile], { env: { ...process.env, PYTHONPATH: process.env.PYTHONPATH ?? "" }, maxBuffer: 1 << 26 });
    if (existsSync(pdf)) unlinkSync(pdf); // keep the extracted text only
  }
  if (!existsSync(txtFile)) { console.warn(`no text for ${file}`); continue; }
  // Lines, with the PDF page index attached; running page headers removed.
  const raw = readFileSync(txtFile, "utf8").replace(/\f@@PAGE (\d+)/g, "\n@@PAGE $1\n").split("\n");
  const L = []; const pg = [];
  let page = 0;
  for (const r of raw) {
    const pm = /^@@PAGE (\d+)$/.exec(r);
    if (pm) { page = Number(pm[1]); continue; }
    const s = stripZw(r);
    if (!s || isHeader(s)) continue;
    L.push(s); pg.push(page);
  }
  // Bill titles ("S.F. No. 2077: A bill for an act relating to ...").
  for (let i = 0; i < L.length; i++) {
    const m = /^([SH])\.\s?F\.\s?No\.\s?(\d+)(?:,[^:]*)?: A bill for an act (relating to .*)$/.exec(L[i]);
    if (!m) continue;
    let t = m[3];
    for (let j = i + 1; j < Math.min(i + 40, L.length) && !/[.]"?$/.test(t.slice(-2)); j++) t += ` ${L[j]}`;
    t = t.replace(/\s+/g, " ").split(/;\s*(?:amending|proposing|repealing|making technical|requiring reports|authorizing rulemaking)/)[0].replace(/[.;]+$/, "");
    if (t.length > 260) t = `${t.slice(0, 260).replace(/\s+\S*$/, "")}…`;
    senateTitles.set(`${m[1]}F ${Number(m[2])}`, sentence(t));
  }
  for (let i = 0; i < L.length; i++) L[i] = L[i].replace(/\b([SH])\.\s?F\.\s?Nos?\.\s?(\d+)/g, "$1F $2"); // "S.F. No. 12" -> "SF 12": no stray periods
  let n = 0, prevEnd = 0;
  for (let i = 0; i < L.length; i++) {
    const m = /^The roll was called, and there were yeas (\d+) and nays (\d+), as follows:$/.exec(L[i]);
    if (!m) continue;
    const yea = Number(m[1]), nay = Number(m[2]);
    let j = i + 1;
    // Names under the Yea/Nay headers (one or several surnames per line); Rule 40 proxy sentences name more senators.
    const yes = new Set(), no = new Set();
    let side = null;
    while (j < L.length) {
      const line = L[j];
      if (line.startsWith("Those who voted in the affirmative")) { side = yes; j++; }
      else if (line.startsWith("Those who voted in the negative")) { side = no; j++; }
      else if (line.startsWith("Pursuant to Rule 40")) {
        let sent = line;
        while (!sent.endsWith(".") && j + 1 < L.length && sent.length < 400) sent += ` ${L[++j]}`;
        j++;
        const pm = /cast the (affirmative|negative) vote on behalf of the following Senators?:\s*(.*)\.$/.exec(sent);
        if (!pm) break;
        for (const nm of pm[2].split(/,\s*(?:and\s+)?|\s+and\s+/).map((x) => x.trim()).filter(Boolean)) (pm[1] === "affirmative" ? yes : no).add(nm);
      } else if (side && NAME.test(line)) {
        j++;
        const t = line.split(" ");
        for (let k = 0; k < t.length; k++) {
          if (MULTI.has(`${t[k]} ${t[k + 1]}`)) side.add(`${t[k]} ${t[k++ + 1]}`);
          else side.add(t[k]);
        }
      } else break;
    }
    n++;
    if (yes.size !== yea || no.size !== nay) {
      if (process.env.MN_DEBUG) console.error("MISMATCH", file, yea, nay, "parsed", yes.size, no.size, "at:", L[j], "|", L[j + 1]);
      drop("upper", "tally-mismatch"); prevEnd = i; continue;
    }
    prevEnd = j;
    const after = L.slice(j, j + 12).join(" ");
    // Attribute the vote to the motion that was put: walk back to the nearest line that *states* a motion on a bill or a
    // resolution ("moved to amend S.F. No. 1740", "S.F. No. 12 was read the third time", "Conference Committee Report on
    // H.F. No. 9"). A bare bill number somewhere earlier (the old behaviour) mislabelled resolutions and motions.
    const norm = (k) => L.slice(k, k + 3).join(" ").replace(/\b([SH])\.\s?F\.\s?Nos?\.\s?(\d+)/g, "$1F $2");
    let anchor = -1, bill = null, why = "no-anchor";
    for (let k = i - 1; k >= Math.max(0, i - 1500); k--) {
      if (/^MOTIONS AND RESOLUTIONS|^REPORTS OF COMMITTEES|^INTRODUCTION AND FIRST READING|^MESSAGES FROM THE HOUSE|^CALENDAR$/.test(L[k])) break;
      const T = norm(k);
      const res = /moved (to amend )?(the adoption of )?(the )?(foregoing )?(Senate )?[Rr]esolution|moved the adoption of the foregoing resolution|Senate Resolution No/.exec(T);
      const conf = /moved[^.]*\b(confirm|appointment)/i.exec(T);
      const bm = /moved(?:[^.]|\.\d)*?\b([SH]F \d+)|\b([SH]F \d+)[^.]*?was read the third time|Conference Committee [Rr]eport\s+on ([SH]F \d+)/.exec(T);
      const hit = [res, conf, bm].filter((x) => x && x.index < L[k].length).sort((x, y) => x.index - y.index)[0];
      if (!hit) continue;
      anchor = k;
      if (hit === res) why = "resolution";
      else if (hit === conf) why = "appointment";
      else bill = hit[1] ?? hit[2] ?? hit[3]; // the bill the motion names first ("identical to SF n" asides come later)
      break;
    }
    if (!bill) { drop("upper", why); continue; }
    const seg = L.slice(anchor, i).join(" ").replace(/\b([SH])\.\s?F\.\s?Nos?\.\s?(\d+)/g, "$1F $2");
    const q = [...seg.matchAll(/The question (?:was taken|recurred) on (.*?)(?:\.|\?")(?=\s|$)/g)].at(-1)?.[1];
    const moved = /moved ([^.]*?)\./.exec(seg)?.[1];
    const passed = /did not prevail|was not passed|not adopted|not repassed|not concurred|failed|lost/i.test(after) ? false
      : /prevailed|passed|adopted|repassed|concurred|agreed/i.test(after) ? true : yea > nay;
    const votes = {}; let bad = false;
    for (const [pos, names] of [["yes", [...yes]], ["no", [...no]]]) for (const nm of names) {
      const id = person("upper", nm);
      if (!id) { unmatched.set(`upper:${nm}`, (unmatched.get(`upper:${nm}`) ?? 0) + 1); bad = true; continue; }
      votes[id] = pos;
    }
    if (bad) { drop("upper", "unmatched-member"); continue; }
    const generic = /^(the )?(adoption of the )?(motion|amendment)(, as amended)?$/i.test(q ?? "");
    const question = sentence((generic && moved ? `${q}: ${moved}` : q ?? moved ?? "").replace(/^the /, "").replace(/\s+/g, " ").slice(0, 200)) || undefined;
    // A floor amendment adopted before this passage vote that rewrote the bill's title ("Amend the title accordingly" /
    // "Amend the title as follows", e.g. a delete-everything amendment): the bill voted on no longer carries the title
    // printed at the head of its order of business, so take the title of the engrossment the Revisor made from that
    // day's amendments (resolved below).
    let retitled = false;
    if (/passage of the bill, as amended/i.test(q ?? "")) {
      let h = anchor;
      while (h > Math.max(0, anchor - 3000) && !L[h].startsWith(`${bill}: A bill for an act`)) h--;
      if (L[h]?.startsWith(`${bill}: A bill for an act`)) {
        retitled = L.slice(h, i).join(" ").split(/(?=Senator [^.]{1,60}? moved to amend )/).slice(1)
          .some((b) => /Amend the title/.test(b) && /amendment was adopted/.test(b));
      }
    }
    senateRolls.push({
      retitled,
      id: `mn-s-${date.replaceAll("-", "")}-${n}`,
      bill, question,
      kind: PROC.test(/motion/i.test(q ?? "") || !q ? `${q} ${moved}` : q) ? "procedural" : classify({ motion_text: q ?? moved ?? "", motion_classification: /passage of the bill|adoption of (the )?(report|conference)|concur/i.test(`${q ?? ""} ${moved ?? ""}`) ? ["passage"] : [] }),
      outcome: `${passed ? "Passed" : "Failed"} ${yea}–${nay}`,
      date, dateLabel: label(date),
      sourceUrl: `${SENATE}/journals//2025-2026/${file}#page=${pg[i] + 1}`,
      votes,
    });
  }
}
const titleCase = (t) => {
  t = t.replace(/\s+/g, " ").split(/;\s*(?:amending|proposing|repealing|making technical|requiring reports|authorizing rulemaking)/)[0].replace(/[.;]+$/, "");
  if (t.length > 260) t = `${t.slice(0, 260).replace(/\s+\S*$/, "")}…`;
  return sentence(t);
};
/** Title of the Revisor's engrossment produced by the Senate's amendments on `date` (the version that was then passed). */
async function versionTitle(bill, date) {
  const [type, num] = bill.split(" ");
  const year = date.slice(0, 4);
  const page = await getText(`https://www.revisor.mn.gov/bills/94/${year}/0/${type}/${num}/`, join(work, "rev", `${type}${num}.html`));
  const us = `${date.slice(5, 7)}/${date.slice(8, 10)}/${year}`;
  const versions = [...page.matchAll(/<tr>\s*<td>(\d\d\/\d\d\/\d{4})<\/td>([\s\S]*?)<\/tr>/g)]
    .filter(([, d, row]) => d === us && /Amended/i.test(text(row)))
    .map(([, , row]) => /\/versions\/([^/"]+)\//.exec(row)?.[1]).filter(Boolean);
  if (!versions.length) return null;
  const v = versions.sort((a, b) => (parseInt(b.replace(/\D/g, ""), 10) || 0) - (parseInt(a.replace(/\D/g, ""), 10) || 0))[0];
  const body = text(await getText(`https://www.revisor.mn.gov/bills/94/${year}/0/${type}/${num}/versions/${v}/`, join(work, "rev", `${type}${num}-v${v}.html`)));
  const m = /A bill for an act (relating to .*?)(?:\.\s*BE IT ENACTED|$)/.exec(body);
  return m ? titleCase(m[1]) : null;
}
for (const { retitled, ...r } of senateRolls) {
  let title = houseTitles.get(r.bill) ?? senateTitles.get(r.bill) ?? r.bill;
  if (retitled) {
    const t = await versionTitle(r.bill, r.date).catch((e) => { console.warn(`revisor ${r.bill}: ${e.message}`); return null; });
    if (t) title = t; else console.warn(`no engrossment title for ${r.bill} amended ${r.date}; journal title kept`);
  }
  rolls.upper.push({ ...r, title });
}
for (const r of rolls.lower) if (senateTitles.get(r.bill) && r.title === r.bill) r.title = senateTitles.get(r.bill);

// --- Inferred absences, then write ---------------------------------------------------------------------------
console.log("dropped:", dropped, "unmatched:", Object.fromEntries(unmatched), "ambiguous:", [...ambiguous.keys()]);
const now = new Date().toISOString();
for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  const dates = list.map((r) => r.date).sort();
  const first = dates[0], lastDay = dates.at(-1);
  const day = (iso, d) => new Date(Date.parse(iso) + d * 864e5).toISOString().slice(0, 10);
  const span = new Map();
  for (const r of list) for (const id of Object.keys(r.votes)) {
    const s = span.get(id) ?? [r.date, r.date];
    if (r.date < s[0]) s[0] = r.date;
    if (r.date > s[1]) s[1] = r.date;
    span.set(id, s);
  }
  for (const [id, s] of span) {
    if (s[0] <= day(first, 14)) s[0] = "0000-00-00";
    if (s[1] >= day(lastDay, -14)) s[1] = "9999-99-99";
  }
  for (const r of list) for (const [id, s] of span) if (!r.votes[id] && r.date >= s[0] && r.date <= s[1]) r.votes[id] = "absent";
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-mn-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("mn", chamber),
    sourceLabel: `Roll call · Minnesota ${chamber === "lower" ? "House" : "Senate"} floor votes (${chamber === "lower" ? "Minnesota House of Representatives" : "Journal of the Senate"})`,
    keyBy: "openstates",
    jurisdiction: "mn",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${first}..${lastDay}, ${list.filter((r) => r.summary).length} with official summary`);
}
console.log("dropped:", dropped);
console.log("ambiguous names (votes dropped):", [...ambiguous.keys()]);
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
