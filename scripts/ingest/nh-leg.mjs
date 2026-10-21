/**
 * New Hampshire 2025 and 2026 House and Senate floor roll calls from the General Court's own publications.
 * Replaces the sampled Open States files state-nh-{lower,upper}.json.
 *
 * House 2025-26: the roll-call search (https://gc.nh.gov/nhgcrollcalls/), an ASP.NET WebForms flow driven by plain
 * form posts (no login, CAPTCHA or bot check): chamber + session year -> session dates -> one results list per date
 * (date, vote #, bill, title, question, yeas, nays) -> a "View" postback per roll call giving every member's
 * Yea / Nay / Not Voting position with party, county and district. The form tokens (__VIEWSTATE etc.) are read from
 * each page and posted back as a browser would.
 * Senate 2025: the Senate Journal PDFs (https://gc.nh.gov/senate/calendars_journals/), because the Senate roll-call
 * search answers HTTP 500. Each journal prints "The following Senators voted Yes: ... voted No: ... Roll Call, Yeas: N -
 * Nays: M."; senators listed as excused, or in the journal's roster but not listed, are stored as absent.
 * Senate 2026: the bulk tables at https://gc.nh.gov/dynamicdatadump/ (RollCallSummary / RollCallHistory / legislators;
 * current year only, no departed members). The same tables cross-check the 2026 House scrape, and their Senate tallies
 * equal those printed in the 2026 Senate journals.
 *
 * Roll calls with no bill (Call of the Roll, a rules suspension on its own) are not votes on legislation and are
 * dropped. A roll call whose printed Yeas/Nays differ from the member positions is dropped and counted.
 * Position mapping: Yea -> yes, Nay -> no, any "Not Voting" (excused or not) -> absent.
 * The General Court publishes no bill summary with roll calls, so none is stored (title only).
 * The roll-call detail page has no stable deep link, so sourceUrl is the roll-call search page.
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/nh.csv (family name, first name,
 * county + district); members who left office fall back to Open States' retired list.
 *
 * Pages are cached in --work (default ~/.cache/nh-leg), so the run is resumable; requests are spaced >= 400 ms.
 * --budget <seconds> stops fetching after that long (exit code 2 = incomplete, run again).
 * Run: node scripts/ingest/nh-leg.mjs [--work dir] [--budget 540]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { sleep, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const BASE = "https://gc.nh.gov/nhgcrollcalls/";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const UA = "thefullrecord-ingest/1.0 (civic transparency)";
const MOTIONS = {
  OTP: "Ought to Pass", OTPA: "Ought to Pass with Amendment", ITL: "Inexpedient to Legislate",
};

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const work = arg("--work", join(homedir(), ".cache/nh-leg"));
const budgetMs = Number(arg("--budget", 540)) * 1000;
const started = Date.now();
mkdirSync(join(work, "pages"), { recursive: true });
let incomplete = false;

// --- tiny cookie-carrying client; POST redirects are followed with GET like a browser
const jar = new Map();
let last = 0;
async function request(url, form) {
  let method = form ? "POST" : "GET", body = form && new URLSearchParams(form).toString();
  for (let hop = 0; hop < 6; hop++) {
    for (let attempt = 0; ; attempt++) {
      const wait = last + 400 - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        const res = await fetch(url, {
          method, body, redirect: "manual", signal: AbortSignal.timeout(30_000),
          headers: { "User-Agent": UA, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        });
        for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
        if (res.status >= 300 && res.status < 400) { url = new URL(res.headers.get("location"), url).href; method = "GET"; body = undefined; break; }
        if (res.status === 429 || res.status >= 500) throw new Error(`${url} -> ${res.status}`);
        if (!res.ok) throw new Error(`${url} -> ${res.status}`);
        return { url, html: await res.text() };
      } catch (e) {
        if (attempt >= 4) throw e;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }
  throw new Error("too many redirects");
}
const unescapeHtml = (s) => s.replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[n]);
const text = (s) => unescapeHtml(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const hidden = (h) => Object.fromEntries([...h.matchAll(/<input[^>]*name="(__[A-Z]+)"[^>]*value="([^"]*)"/g)].map((m) => [m[1], unescapeHtml(m[2])]));
const outOfTime = () => { if (Date.now() - started > budgetMs) { incomplete = true; return true; } return false; };

// --- scrape one chamber-year into cached detail pages; returns parsed roll calls
async function scrape(body, year) {
  const chamber = body === "House" ? "lower" : "upper";
  const cacheList = join(work, "pages", `${body}-${year}-dates.json`);
  const done = (n) => join(work, "pages", `${body}-${year}-${n}.json`);
  const parsed = [];
  let dates = existsSync(cacheList) ? JSON.parse(readFileSync(cacheList, "utf8")) : null;
  let start = null; // search page for the year, fetched lazily
  const openYear = async () => {
    const home = await request(BASE);
    const res = await request(BASE, { ...hidden(home.html), [`ctl00$pageBody$lb${body}SessionYears`]: String(year), [`ctl00$pageBody$btn${body}Search`]: "Search" });
    return res;
  };
  if (!dates) {
    start = await openYear();
    const sel = /id="pageBody_lblSessionDates"[\s\S]*?<\/select>/.exec(start.html)?.[0] ?? "";
    dates = [...sel.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
    if (!dates.length) throw new Error(`no session dates for ${body} ${year}`);
    writeFileSync(cacheList, JSON.stringify(dates));
  }
  for (const date of dates) {
    const listFile = join(work, "pages", `${body}-${year}-${date.replaceAll("/", "-")}.json`);
    let rows = existsSync(listFile) ? JSON.parse(readFileSync(listFile, "utf8")) : null;
    let listPage;
    const todo = () => !rows || rows.some((r) => !existsSync(done(r.vote)));
    if (todo()) {
      if (outOfTime()) return null;
      start = await openYear();
      listPage = await request(start.url, { ...hidden(start.html), "ctl00$pageBody$btnSearch": "Search", "ctl00$pageBody$lblSessionDates": date });
      rows = [];
      for (const m of listPage.html.matchAll(/<tr>\s*<th scope="row"[^>]*>([^<]*)<\/th>([\s\S]*?)<\/tr>/g)) {
        const cells = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
        if (cells.length < 7) continue;
        const target = /__doPostBack\(&#39;([^&]+)&#39;/.exec(cells[6])?.[1];
        const [vote, bill, title, question, yeas, nays] = cells.slice(0, 6).map(text);
        rows.push({ date: text(m[1]), vote, bill, title, question, yeas: Number(yeas), nays: Number(nays), target });
      }
      if (!rows.length) throw new Error(`empty list ${body} ${year} ${date}`);
      writeFileSync(listFile, JSON.stringify(rows));
    }
    for (const row of rows) {
      let detail = existsSync(done(row.vote)) ? JSON.parse(readFileSync(done(row.vote), "utf8")) : null;
      if (!detail) {
        if (outOfTime()) return null;
        if (!listPage) { // list page needed for the postback tokens (and session state)
          start = await openYear();
          listPage = await request(start.url, { ...hidden(start.html), "ctl00$pageBody$btnSearch": "Search", "ctl00$pageBody$lblSessionDates": date });
        }
        const page = await request(listPage.url, { ...hidden(listPage.html), __EVENTTARGET: row.target, __EVENTARGUMENT: "" });
        const field = (id) => text(new RegExp(`id="pageBody_${id}">([\\s\\S]*?)</span>`).exec(page.html)?.[1] ?? "");
        const members = [...page.html.matchAll(/<th scope="row"[^>]*>([^<]+)<\/th>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/g)]
          .map((m) => ({ name: text(m[1]), party: text(m[2]), county: text(m[3]), district: text(m[4]), how: text(m[5]) }));
        detail = { date: field("lblVoteDate"), vote: field("lblVoteNo"), bill: field("lblBillNo"), title: field("lblBillTitle"), question: field("lblQuestion_Motion"), yeas: Number(field("lblYeas")), nays: Number(field("lblNays")), members };
        if (detail.vote !== row.vote || detail.date !== row.date || !members.length) throw new Error(`detail mismatch for ${body} ${year} #${row.vote} (${detail.vote}, ${detail.date}, ${members.length} members)`);
        writeFileSync(done(row.vote), JSON.stringify(detail));
      }
      parsed.push({ ...detail, listYeas: row.yeas, listNays: row.nays });
    }
  }
  console.log(`${body} ${year}: ${parsed.length} roll calls read`);
  return parsed;
}

// --- Senate: the Senate roll-call search returns HTTP 500 for every year, so the Senate Journal PDFs
// (https://gc.nh.gov/senate/calendars_journals/) are parsed instead. Each journal prints, for a recorded vote,
// "The following Senators voted Yes: ... The following Senators voted No: ... Roll Call, Yeas: N - Nays: M."
async function senateJournals(year) {
  const page = "https://gc.nh.gov/senate/calendars_journals/";
  const listFile = join(work, "pages", `SenateJournals-${year}.json`);
  let files = existsSync(listFile) ? JSON.parse(readFileSync(listFile, "utf8")) : null;
  if (!files) {
    const post = async (res, extra) => request(page, { ...hidden(res.html), "ctl00$pageBody$ddlCalJourn": "SenateJournal", "ctl00$pageBody$ddlYears": "2026", __EVENTARGUMENT: "", ...extra });
    let res = await request(page);
    res = await post(res, { __EVENTTARGET: "ctl00$pageBody$ddlCalJourn" });
    res = await post(res, { __EVENTTARGET: "ctl00$pageBody$ddlYears", "ctl00$pageBody$ddlYears": String(year) });
    const sel = /id="pageBody_ddlDoc"[\s\S]*?<\/select>/.exec(res.html)?.[0] ?? "";
    files = [...sel.matchAll(/value="([^"]+\.pdf)"/g)].map((m) => unescapeHtml(m[1]));
    if (!files.length) throw new Error(`no Senate journals listed for ${year}`);
    writeFileSync(listFile, JSON.stringify(files));
  }
  const out = [];
  for (const name of files) {
    const base = join(work, "pages", `SJ-${year}-${name.replace(/[^A-Za-z0-9]+/g, "_")}`);
    if (!existsSync(`${base}.txt`)) {
      if (outOfTime()) return null;
      if (!existsSync(`${base}.pdf`)) {
        const res = await fetch(`${page}viewer.aspx?fileName=${encodeURIComponent(`Journals\\${year}\\${name}`)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`journal ${name} -> ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.subarray(0, 4).toString() !== "%PDF") throw new Error(`journal ${name} is not a PDF`);
        writeFileSync(`${base}.pdf`, buf);
        await sleep(400);
      }
      await new Promise((resolve, reject) => execFile("python3", [join(dirname(fileURLToPath(import.meta.url)), "pdf-fulltext.py"), `${base}.pdf`, `${base}.txt`],
        { env: { ...process.env, PYTHONPATH: process.env.PYTHONPATH ?? "/tmp/claude-1000/pp" } }, (e, _o, err) => (e || err ? reject(e ?? new Error(err)) : resolve())));
    }
    out.push({ name, text: readFileSync(`${base}.txt`, "utf8") });
  }
  return out;
}

// --- roster: Open States current people + retired list
function csv(textIn) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < textIn.length; i++) {
    const c = textIn[i];
    if (q) { if (c === '"') { if (textIn[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  const [head, ...rest] = rows;
  return rest.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const peopleFile = join(work, "people.csv");
if (!existsSync(peopleFile)) writeFileSync(peopleFile, (await request("https://data.openstates.org/people/current/nh.csv")).html);
const people = csv(readFileSync(peopleFile, "utf8"));
const retiredFile = join(work, "retired.json");
if (!existsSync(retiredFile)) {
  // The contents API caps a directory at 1000 entries, so list the retired folder through its tree object instead.
  const api = async (path) => {
    const res = await fetch(`https://api.github.com/repos/openstates/people/${path}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": UA } });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  };
  const dir = (await api("contents/data/nh")).find((e) => e.name === "retired");
  const tree = await api(`${"git"}/trees/${dir.sha}`);
  if (tree.truncated) throw new Error("retired tree truncated");
  writeFileSync(retiredFile, JSON.stringify(tree.tree.map((e) => e.path)));
}
const retired = JSON.parse(readFileSync(retiredFile, "utf8")).flatMap((name) => {
  const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
  if (!m) return [];
  const t = m[1].split("-");
  return [{ tokens: t.map(norm), id: `ocd-person/${m[2]}` }];
});
const personCache = new Map();
function personFor(chamber, m) {
  const key = `${chamber}|${m.name}|${m.county}|${m.district}`;
  if (personCache.has(key)) return personCache.get(key);
  const [lastRaw, firstRaw = ""] = m.name.split(/,\s*/);
  const last = norm(lastRaw.replace(/\s+(Jr|Sr|II|III|IV)\.?$/i, "")), first = norm(firstRaw.split(/\s+/)[0]);
  const inChamber = people.filter((p) => p.current_chamber === chamber);
  const family = inChamber.filter((p) => norm(p.family_name) === last || norm(p.name).endsWith(last));
  let pick = family;
  if (pick.length > 1) { // nicknames (Tom/Thomas) make first names unreliable, so try the district, then the first name
    const byDistrict = pick.filter((p) => p.current_district === `${m.county} ${m.district}`);
    const byName = pick.filter((p) => norm(p.given_name).startsWith(first.slice(0, 3)) || first.startsWith(norm(p.given_name).slice(0, 3)));
    pick = byDistrict.length === 1 ? byDistrict : byName.length ? byName : pick;
  }
  // A lone family-name hit must also agree on the first initial or the district, so a departed member is not
  // mistaken for a current one who shares the surname.
  const agrees = (p) => norm(p.given_name)[0] === first[0] || p.current_district === `${m.county} ${m.district}`;
  let id = pick.length === 1 && agrees(pick[0]) ? pick[0].id : undefined;
  if (!id) {
    // Retired members: same family name (also multi-word, "St. Clair") and first initial; if that is ambiguous, a
    // first name that is a prefix of the other (Jon/Jonathan).
    const family = retired.filter((r) => (r.tokens.includes(last) || r.tokens.slice(1).join("") === last) && r.tokens[0][0] === first[0]);
    const close = family.filter((r) => r.tokens[0].startsWith(first) || first.startsWith(r.tokens[0]));
    const hits = family.length === 1 ? family : close;
    if (hits.length === 1) id = hits[0].id;
  }
  personCache.set(key, id);
  return id;
}

// --- bulk dump (current year only): used for 2026 Senate roll calls (journals for the later 2026 days are not published
// yet) and as a tally cross-check of the 2026 House scrape
async function dumpFile(name) {
  const file = join(work, `dump-${name}`);
  if (!existsSync(file)) writeFileSync(file, (await request(`https://gc.nh.gov/dynamicdatadump/${name}`)).html);
  return readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean).map((l) => l.split("|"));
}
const dumpMembers = new Map((await dumpFile("legislators.txt")).map((r) => [r[0], { last: r[1], first: r[2], body: r[4] }]));
const dumpSummary = (await dumpFile("RollCallSummary.txt")).filter((r) => r[0] === "2026");
const dumpHistory = new Map(); // "H|3" -> [[memberId, how]]
for (const r of await dumpFile("RollCallHistory.txt")) {
  if (r[0] !== "2026") continue;
  const key = `${r[1]}|${r[2]}`;
  (dumpHistory.get(key) ?? dumpHistory.set(key, []).get(key)).push([r[4], r[6]]);
}
const lsrTitles = new Map((await dumpFile("LSRs.txt")).filter((r) => r[9]).map((r) => [r[10].replace(/\s+/g, ""), r[2]]));

// --- Senate journals -> roll calls
const MONTH_NUM = Object.fromEntries(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].map((m, i) => [m, i + 1]));
const BILL_HEAD = /^((?:SB|HB|SR|HR|SCR|HCR|CACR|SJR|HJR)\s?\d+(?:-[A-Z]+)?),\s+(.*)$/;
function parseJournal({ name, text }, year) {
  const dm = /([A-Za-z]+) (\d{1,2}),? (\d{4})/.exec(name);
  if (!dm || !MONTH_NUM[dm[1].toLowerCase()] || Number(dm[3]) !== year) return [];
  const date = `${dm[3]}-${String(MONTH_NUM[dm[1].toLowerCase()]).padStart(2, "0")}-${dm[2].padStart(2, "0")}`;
  const clean = text.replace(/\f?@@PAGE \d+/g, "\n").split("\n")
    .filter((l) => !/^\s*(\d+ )?SENATE JOURNAL( \d+ [A-Z]+ \d{4})?( \d+)?\s*$|^\s*\d+ [A-Z]+ \d{4} SENATE JOURNAL( \d+)?\s*$/.test(l)).join("\n");
  const re = /The following Senators voted Yes:\s*([\s\S]*?)\s*The following Senators voted No:\s*([\s\S]*?)\s*Roll Call, Yeas:\s*(\d+)\s*-\s*Nays:\s*(\d+)\.\s*([^\n]*)/g;
  // A list ends at its first sentence-final period; "(None)" is an empty list.
  const names = (s) => { const t = s.replace(/\s+/g, " ").replace(/(\w) - (\w)/g, "$1$2").trim().split(/\.(?:\s|$)/)[0]; return /^\(?none\)?$/i.test(t) ? [] : t.split(/,\s*/).filter(Boolean); };
  const found = []; let m;
  while ((m = re.exec(clean))) {
    const before = clean.slice(0, m.index);
    const lines = before.split("\n");
    let bill = "", title = "", question = "";
    for (let i = lines.length - 1; i >= 0 && !bill; i--) {
      const h = BILL_HEAD.exec(lines[i]);
      if (!h) continue;
      bill = h[1]; title = h[2];
      // A heading wraps over several lines (hyphenated at the break) until the sentence ends.
      for (let j = i + 1; j < Math.min(i + 3, lines.length) && !/[.)]\s*$/.test(title); j++) title = /\s-\s*$/.test(title) ? title.replace(/\s-\s*$/, "") + lines[j] : `${title} ${lines[j]}`;
    }
    const qs = [...before.slice(Math.max(0, before.length - 4000)).matchAll(/^The question is (?:on )?(.*)$/gm)];
    question = qs.length ? qs.at(-1)[0].replace(/^The question is (on )?(the )?/, "").replace(/^adoption of (the )?(motion of )?/i, "").split(/\.\s/)[0].replace(/\.$/, "") : "";
    question = question.charAt(0).toUpperCase() + question.slice(1);
    if (/become law/.test(question)) bill = /([SH]B\s?\d+)/.exec(question)?.[1] ?? bill;
    // Anything after the No list ("The following Senators were excused: X.") is an explicit non-vote.
    const [noPart, ...otherParts] = m[2].split(/The following Senators (?:were|was) [a-z ]+:\s*/);
    found.push({ yes: names(m[1]), no: names(noPart), away: otherParts.flatMap((o) => names(o.replace(/\.\s*$/, ""))), yeas: Number(m[3]), nays: Number(m[4]), result: m[5].trim(), bill, title, question, index: m.index });
  }
  const roster = new Set(found.flatMap((f) => [...f.yes, ...f.no, ...f.away]));
  return found.map((f, i) => ({ ...f, date, n: i + 1, roster: [...roster], url: `https://gc.nh.gov/senate/calendars_journals/viewer.aspx?fileName=${encodeURIComponent(`Journals\\${year}\\${name}`)}` }));
}
const senateByFamily = (family) => {
  const f = norm(family);
  const hit = people.filter((p) => p.current_chamber === "upper" && (norm(p.family_name) === f || norm(p.name).endsWith(f)));
  if (hit.length === 1) return hit[0].id;
  const old = retired.filter((r) => r.tokens.includes(f));
  return old.length === 1 ? old[0].id : undefined;
};

// --- build: every source is normalized to { chamber, id, date, bill, title, question, yeas, nays, members: [{ id|label, pos }], url }
const years = [2025, 2026];
const stats = { noBill: 0, mismatch: 0, unmatched: new Map(), positions: new Map(), crossCheck: { checked: 0, differ: [] } };
const rolls = [];
const unmatched = (label) => stats.unmatched.set(label, (stats.unmatched.get(label) ?? 0) + 1);
const POS = (how) => (how === "Yea" ? "yes" : how === "Nay" ? "no" : /^Not Voting/.test(how) ? "absent" : how === "Presiding" || how === "" ? null : undefined);

const house = {};
for (const year of years) {
  house[year] = await scrape("House", year);
  if (!house[year]) console.log(`House ${year}: time budget reached, run again to continue`);
}
const journals2025 = await senateJournals(2025);
if (incomplete) { console.log("INCOMPLETE: re-run to continue (cached pages are kept)"); process.exit(2); }

for (const year of years) for (const r of house[year]) {
  const [mm, dd, yyyy] = r.date.split("/");
  const members = [];
  for (const m of r.members) {
    stats.positions.set(m.how, (stats.positions.get(m.how) ?? 0) + 1);
    const pos = POS(m.how);
    if (pos === undefined) throw new Error(`unknown position ${JSON.stringify(m.how)} in ${r.bill} #${r.vote}`);
    if (pos) members.push({ id: personFor("lower", m), label: `lower ${m.name} (${m.county} ${m.district})`, pos });
  }
  rolls.push({ chamber: "lower", id: `nh-h-${yyyy}-${Number(r.vote)}`, date: `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`, bill: r.bill, title: r.title, question: r.question, yeas: r.yeas, nays: r.nays, listTally: [r.listYeas, r.listNays], members, url: BASE, dump: year === 2026 ? `H|${Number(r.vote)}` : null });
}
for (const j of journals2025) {
  for (const f of parseJournal(j, 2025)) {
    const members = [
      ...f.yes.map((n) => ({ id: senateByFamily(n), label: `upper ${n}`, pos: "yes" })),
      ...f.no.map((n) => ({ id: senateByFamily(n), label: `upper ${n}`, pos: "no" })),
      ...f.roster.filter((n) => !f.yes.includes(n) && !f.no.includes(n)).map((n) => ({ id: senateByFamily(n), label: `upper ${n}`, pos: "absent" })),
    ];
    const bill = f.bill.replace(/-[A-Z]+$/, "");
    rolls.push({ chamber: "upper", id: `nh-s-${f.date}-${f.n}`, date: f.date, bill, title: f.title.replace(/\s*\([^()]*\)?\s*$/, ""), question: f.question || "Roll call", yeas: f.yeas, nays: f.nays, listTally: [f.yes.length, f.no.length], members, url: f.url, result: f.result, dump: null });
  }
}
for (const r of dumpSummary.filter((x) => x[1] === "S")) {
  const [mm, dd, yyyy] = r[3].split(" ")[0].split("/");
  const members = [];
  for (const [mid, how] of dumpHistory.get(`S|${r[2]}`) ?? []) {
    const pos = POS(how);
    if (pos === undefined) throw new Error(`unknown position ${JSON.stringify(how)} in S #${r[2]}`);
    const dm = dumpMembers.get(mid);
    if (pos) members.push({ id: dm ? senateByFamily(dm.last) : undefined, label: `upper ${dm ? `${dm.last}, ${dm.first}` : `member ${mid}`}`, pos });
  }
  rolls.push({ chamber: "upper", id: `nh-s-${yyyy}-${Number(r[2])}`, date: `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`, bill: r[4], title: r[12].trim(), question: r[11], yeas: Number(r[5]), nays: Number(r[6]), listTally: [Number(r[5]), Number(r[6])], members, url: BASE, dump: null });
}

// 2026 House scrape vs the dump: every roll call present and same tally
for (const s of dumpSummary.filter((x) => x[1] === "H")) {
  const mine = rolls.find((x) => x.dump === `H|${Number(s[2])}`);
  stats.crossCheck.checked++;
  if (!mine || mine.yeas !== Number(s[5]) || mine.nays !== Number(s[6])) stats.crossCheck.differ.push(`H #${s[2]}`);
}

const built = { lower: [], upper: [] };
const titleOf = new Map(rolls.filter((r) => r.title && r.chamber === "lower").map((r) => [r.bill.replace(/\s+/g, ""), r.title]));
for (const r of rolls) {
  const billMatch = /^([A-Z]+)\s*0*(\d+)$/.exec((r.bill ?? "").replace(/\s+/g, ""));
  if (!billMatch) { stats.noBill++; continue; }
  let yes = 0, no = 0; const votes = {};
  for (const m of r.members) {
    if (m.pos === "yes") yes++; else if (m.pos === "no") no++;
    if (!m.id) unmatched(m.label);
    else if (votes[m.id]) throw new Error(`${r.id}: ${m.label} resolves to a member already recorded in this roll call`);
    else votes[m.id] = m.pos;
  }
  if (yes !== r.yeas || no !== r.nays || r.listTally[0] !== r.yeas || r.listTally[1] !== r.nays) { stats.mismatch++; console.log("tally mismatch", r.id, r.bill, yes, no, r.yeas, r.nays); continue; }
  const question = MOTIONS[r.question] ? `${r.question} (${MOTIONS[r.question]})` : r.question;
  const needsTwoThirds = /veto|rules? suspension|suspend|become law/i.test(r.question);
  const passed = r.result ? !/^Failed/i.test(r.result) : needsTwoThirds ? yes * 3 >= (yes + no) * 2 : yes > no;
  const [yyyy, mm, dd] = r.date.split("-");
  built[r.chamber].push({
    id: r.id,
    bill: `${billMatch[1]} ${Number(billMatch[2])}`,
    title: (r.chamber === "lower" && r.title) || lsrTitles.get(r.bill.replace(/\s+/g, "")) || titleOf.get(r.bill.replace(/\s+/g, "")) || r.title || r.question,
    question,
    kind: classify({ motion_text: MOTIONS[r.question] ?? r.question, motion_classification: r.question in MOTIONS ? ["passage"] : [] }),
    outcome: `${passed ? "Passed" : "Failed"} ${yes}–${no}`,
    date: r.date,
    dateLabel: `${MONTHS[Number(mm) - 1]} ${Number(dd)}, ${yyyy}`,
    sourceUrl: r.url,
    votes,
  });
}

const now = new Date().toISOString();
for (const chamber of ["lower", "upper"]) {
  const list = built[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id, "en", { numeric: true }));
  await writeSnapshot(join(OUT, `state-nh-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("nh", chamber),
    sourceLabel: `Roll call · New Hampshire ${chamber === "lower" ? "House" : "Senate"} floor votes (NH General Court)`,
    keyBy: "openstates",
    jurisdiction: "nh",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.at(-1)?.date} .. ${list[0]?.date}`);
}
console.log("dropped: no bill", stats.noBill, "| tally mismatch", stats.mismatch);
console.log("2026 House cross-check vs bulk dump:", stats.crossCheck.checked, "checked, differing:", stats.crossCheck.differ);
console.log("positions seen:", Object.fromEntries(stats.positions));
console.log("unmatched members (votes dropped):", Object.fromEntries(stats.unmatched));
