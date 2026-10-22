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
// A bill heading: "HB 115-FN, relative to ..." or, in the Committee of Conference reports section, "Committee of
// Conference Report on HB 60, relative to ...". Suffixes can stack ("HB 2-FN-A-LOCAL").
const BILL_HEAD = /^(?:Committee of Conference Report on )?((?:SB|HB|SR|HR|SCR|HCR|CACR|SJR|HJR)\s?\d+(?:-[A-Z]+)*),\s+(.*)$/;
// The title an amendment gives the bill: "Amend the title of the bill by replacing it with the following: AN ACT ...".
const TITLE_AMEND = /Amend the title of the bill by replacing (?:it )?with the following:\s*AN ACT\s+([\s\S]*?\.)[ \t]*\n/g;
const joinWrapped = (s) => s.replace(/\s-\s*\n\s*/g, "").replace(/\s+/g, " ").trim();
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
    let bill = "", title = "", question = "", headAt = -1, conference = false;
    for (let i = lines.length - 1; i >= 0 && !bill; i--) {
      const h = BILL_HEAD.exec(lines[i]);
      if (!h) continue;
      bill = h[1]; title = h[2]; headAt = i; conference = /^Committee of Conference Report on /.test(lines[i]);
      // A heading wraps over several lines (hyphenated at the break) until the sentence ends.
      for (let j = i + 1; j < Math.min(i + 3, lines.length) && !/[.)]\s*$/.test(title); j++) title = /\s-\s*$/.test(title) ? title.replace(/\s-\s*$/, "") + lines[j] : `${title} ${lines[j]}`;
    }
    // The heading prints the title the bill had when it was taken up. An amendment that retitles the bill and is adopted
    // before this roll call (a committee or floor amendment adopted by voice vote, say) means the vote was on the
    // retitled text, so the vote carries that title; so does a vote on a Committee of Conference report that retitles.
    // The amendment prints only the "AN ACT" text: the "(New Title)" / "(Second New Title)" prefix the General Court
    // later gives the bill is not derivable from the journal (it does not count every retitling amendment), so none is added.
    if (headAt >= 0) {
      const section = lines.slice(headAt).join("\n");
      for (const a of section.matchAll(TITLE_AMEND)) {
        const after = section.slice(a.index + a[0].length);
        const decided = /The question is on the adoption of [^\n]*?\.\s*(Adopted|Failed)\b/.exec(after);
        if (decided ? decided[1] === "Adopted" : conference) title = joinWrapped(a[1]);
      }
    }
    const qs = [...before.slice(Math.max(0, before.length - 4000)).matchAll(/^The question is (?:on )?(.*)$/gm)];
    question = qs.length ? qs.at(-1)[0].replace(/^The question is (on )?(the )?/, "").replace(/^adoption of (the )?(motion of )?/i, "").split(/\.\s/)[0].replace(/\.$/, "") : "";
    question = question.charAt(0).toUpperCase() + question.slice(1);
    if (/become law/.test(question)) {
      // A veto vote: the bill is the one named in the question, and its title the one the Governor's veto message quotes
      // ("I have vetoed Senate Bill 213, relative to ..."), not the nearest bill heading, which belongs to another bill.
      const named = /([SH]B)\s?(\d+)/.exec(question);
      if (named) {
        bill = `${named[1]} ${named[2]}`;
        const msg = new RegExp(`vetoed ${named[1] === "SB" ? "Senate" : "House"} Bill ${named[2]},\\s+([\\s\\S]*?\\.)\\s`).exec(before.slice(-6000));
        title = msg ? joinWrapped(msg[1]) : "";
      }
    }
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
    const bill = f.bill.replace(/(-[A-Z]+)+$/, "");
    rolls.push({ chamber: "upper", source: "journal", id: `nh-s-${f.date}-${f.n}`, date: f.date, bill, title: f.title.replace(/\s*\([^()]*\)?\s*$/, "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim(), question: f.question || "Roll call", yeas: f.yeas, nays: f.nays, listTally: [f.yes.length, f.no.length], members, url: f.url, result: f.result, dump: null });
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
  rolls.push({ chamber: "upper", id: `nh-s-${yyyy}-${Number(r[2])}`, date: `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`, bill: r[4], title: r[12].trim(), source: "dump", question: r[11], yeas: Number(r[5]), nays: Number(r[6]), listTally: [Number(r[5]), Number(r[6])], members, url: BASE, dump: null });
}

// 2026 House scrape vs the dump: every roll call present and same tally
for (const s of dumpSummary.filter((x) => x[1] === "H")) {
  const mine = rolls.find((x) => x.dump === `H|${Number(s[2])}`);
  stats.crossCheck.checked++;
  if (!mine || mine.yeas !== Number(s[5]) || mine.nays !== Number(s[6])) stats.crossCheck.differ.push(`H #${s[2]}`);
}

// Title of the roll call = the bill's official title as of that vote. Each source records one with the roll call: the House
// roll-call search, the bulk dump's RollCallSummary (field 12) and the Senate Journal heading (plus any retitling amendment
// adopted before the vote, see parseJournal). The current title (LSRs.txt) is used only for a vote on the bill's final text,
// or when the source gives none; it must not replace the title at the vote, because bills are retitled after early votes.
// TITLE_AT_VOTE holds corrections confirmed against the General Court's bill status pages (gc.nh.gov/bill_status, docket
// + bill text / amendment PDFs): 2025 House roll calls whose search entry carries the motion or the House bill's original
// title on a vote on a Senate-retitled final version, and votes taken after a retitling amendment had been adopted.
const SB14_HOUSE = "(New Title) relative to the penalty for certain fentanyl-related offenses; relative to establishing a mandatory minimum sentence for the crime of distribution of a controlled drug with death resulting; and relative to amending the penalties for the possession and use of a quantity of psilocybin for persons 18 years of age or older.";
const HB1300_HOUSE = "(New Title) establishing a biennial school district local tax cap question and related limitations on central office administrative expenses in school districts.";
const HB377_FINAL = "(New Title) relative to health care professionals administering hormone treatments and puberty blockers and relative to recognizing the second Thursday in October as children's environmental health day.";
const TITLE_AT_VOTE = {
  // final version (concurrence / conference report / veto override) of a bill retitled after the House title was recorded
  "nh-h-2025-129": "relative to litigation alleging constitutional rights violations.",
  "nh-h-2025-193": "(New Title) repealing the license to sell pistols and revolvers and limiting liability for certain design features of firearms.",
  "nh-h-2025-212": "(New Title) establishing a parental bill of rights.",
  "nh-h-2025-232": "(New Title) establishing the crime of and penalties for unlawful use of unmanned aircraft systems and changing the reckless driving minimum penalties.",
  "nh-h-2025-234": "(New Title) allowing public schools to contract with any approved nonpublic school.",
  "nh-h-2025-236": "(New Title) relative to the approval process for new construction and to the adoption of energy efficient and clean energy districts by municipalities.",
  "nh-h-2025-237": "to allow for off-grid electricity providers in New Hampshire.",
  "nh-h-2025-243": "(New Title) increasing the maximum benefits for first responders critically injured in the line of duty, relative to the determination of education adequacy grants and calculation of certain group II benefits within the retirement system.",
  "nh-h-2025-244": HB377_FINAL,
  "nh-h-2025-246": "(New Title) making temporary appropriations for the expenses and encumbrances of the state of New Hampshire.",
  "nh-h-2025-252": "(New Title) limiting breast surgeries for minors, relative to residential care and health facility licensing, and relative to the collection and reporting of abortion statistics by health care providers and medical facilities.",
  "nh-h-2025-253": "(New Title) making temporary appropriations for the expenses and encumbrances of the state of New Hampshire.",
  "nh-h-2025-256": "(New Title) relative to the responsibility of local school districts to provide transportation for pupils in kindergarten.",
  "nh-h-2025-258": "enabling school districts to adopt partisan school district elections.",
  "nh-h-2025-260": "relative to parental notice for non-academic surveys in public schools.",
  "nh-h-2025-262": "(New Title) relative to use of accessible voting systems.",
  "nh-h-2025-263": "(Second New Title) relative to health education and requiring the viewing of certain videos demonstrating gestational development.",
  "nh-h-2025-264": "(New Title) requiring school districts to adopt policies establishing a cell phone-free education.",
  // SB 14: House amendment 2025-2372h (NT) adopted by roll call 217-164 before these votes; the conference report kept it
  "nh-h-2025-208": SB14_HOUSE, "nh-h-2025-209": SB14_HOUSE, "nh-h-2025-239": SB14_HOUSE, "nh-h-2025-240": SB14_HOUSE, "nh-h-2025-241": SB14_HOUSE,
  // SB 15: House amendment 2025-3096h (NT, replaces the bill) adopted by voice vote before the 179-159 vote
  "nh-h-2026-5": "(New Title) relative to incorporating hard labor as a sentencing option for capital murder and serious sexual assaults on children, defining hard labor, establishing medical exemptions and penalties for abuse thereof, providing alternative punitive measures for legitimate medical exemptions, and authorizing jury determination of hard labor in qualifying cases.",
  // HB 1300: committee amendment 2026-0980h (retitles, replaces the bill) adopted by voice vote before these votes
  "nh-h-2026-164": HB1300_HOUSE, "nh-h-2026-165": HB1300_HOUSE,
  // Senate Journal votes whose retitled text is known with the official "(New Title)" prefix (the journal prints only the
  // AN ACT text): amendments adopted before the vote, and conference reports / veto votes on the final version
  "nh-s-2025-05-15-7": "(New Title) allowing public schools to contract with any approved nonpublic school.",
  "nh-s-2025-06-05-20": HB377_FINAL, "nh-s-2025-06-26-5": HB377_FINAL,
  "nh-s-2025-06-26-4": "(Third New Title) prohibiting school facilities from being used to provide shelter for aliens; relative to department of health and human services contracts; and requiring the use of public notices before reassessment of property values for tax purposes.",
  "nh-s-2025-06-26-6": "(New Title) relative to background checks during motions to return firearms and ammunition and relative to invalidating out-of-state driver's licenses issued to undocumented immigrants and relative to requiring schools to engage an owner's project manager for construction of school building aid projects at the time of application.",
  "nh-s-2025-06-26-7": "(New Title) limiting breast surgeries for minors, relative to residential care and health facility licensing, and relative to the collection and reporting of abortion statistics by health care providers and medical facilities.",
  "nh-s-2025-06-26-10": "(New Title) making temporary appropriations for the expenses and encumbrances of the state of New Hampshire.",
  "nh-s-2025-10-23-1": "(New Title) relative to electioneering by public employees and relative to absentee voting.",
};
// The journal often prints a retitled bill's title without its "(New Title)" prefix; when another source gives the same
// title with the prefix, use that form.
const NEW_TITLE = /^\((?:[A-Z][a-z]+ )?New Title\)\s*/;
const prefixed = new Map([...rolls.map((r) => [r.bill, r.title]), ...[...lsrTitles].map(([b, t]) => [b, t]), ...Object.entries(TITLE_AT_VOTE).map(([id, t]) => [rolls.find((x) => x.id === id)?.bill ?? "", t])]
  .filter(([, t]) => t && NEW_TITLE.test(t)).map(([b, t]) => [`${b.replace(/\s+/g, "")}|${t.replace(NEW_TITLE, "").trim()}`, t.trim()]));
function titleAtVote(r) {
  const key = r.bill.replace(/\s+/g, "");
  if (TITLE_AT_VOTE[r.id]) return TITLE_AT_VOTE[r.id];
  if (r.source === "journal" && !NEW_TITLE.test(r.title) && prefixed.has(`${key}|${r.title}`)) return prefixed.get(`${key}|${r.title}`);
  if (r.source === "dump" && finalText(r.question) && lsrTitles.get(key)) return lsrTitles.get(key);
  if (!motionTitle(r)) return r.title;
  return lsrTitles.get(key) || titleOf.get(key) || r.title || r.question;
}

const built = { lower: [], upper: [] };
// A House roll call whose title field holds only the motion ("Concur", "Veto Override", "Remove from Table") has no title.
const motionTitle = (r) => !r.title || norm(r.title) === norm(r.question);
const titleOf = new Map(rolls.filter((r) => !motionTitle(r) && r.chamber === "lower").map((r) => [r.bill.replace(/\s+/g, ""), r.title]));
// A vote on the bill's final text (veto override, concurrence, conference report) is on the version the bill ends with.
const finalText = (q) => /veto|concur|conference|cofc|become law/i.test(q);
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
  // Constitutional amendments need three-fifths of the entire membership (Part II, Art. 100): 240 of 400 House, 15 of 24 Senate.
  const needsThreeFifthsOfMembers = billMatch[1] === "CACR" && /^(OTPA?|Ought to Pass)\b/i.test(r.question);
  // The Senate Journal prints the official result after the tally: "Adopted[, ...]", "Adopted by necessary 2/3 vote",
  // "Failed.", "Veto sustained lacking necessary 2/3 vote." (an override that failed). Anything else is not recognised and
  // falls back to the threshold rules below rather than being read as a pass.
  const official = !r.result ? undefined
    : /^(Adopted|Passed|Veto overridden)\b/i.test(r.result) ? true
    : /^(Failed|Veto sustained|Lost)\b/i.test(r.result) ? false : undefined;
  if (r.result && official === undefined) console.log("unrecognised journal result", r.id, JSON.stringify(r.result));
  const passed = official !== undefined ? official
    : needsThreeFifthsOfMembers ? yes >= (r.chamber === "lower" ? 240 : 15) && yes > no
    : needsTwoThirds ? yes * 3 >= (yes + no) * 2 : yes > no;
  const [yyyy, mm, dd] = r.date.split("-");
  built[r.chamber].push({
    id: r.id,
    bill: `${billMatch[1]} ${Number(billMatch[2])}`,
    title: titleAtVote(r),
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
