#!/usr/bin/env node
/**
 * One-off ingest: scrape recent NYC Council roll-call votes from Legistar InSite
 * (https://legistar.council.nyc.gov) into src/server/snapshot/council.json.
 *
 * The Legistar web API (webapi.legistar.com) requires a token, so this scrapes
 * the public ASP.NET pages instead: MainBody.aspx (member roster), Calendar.aspx
 * (find the last two Stated Meetings that were actually held), MeetingDetail.aspx
 * (agenda rows with "Approved by Council" actions), HistoryDetail.aspx (per-member
 * roll call for each action).
 *
 * Politeness: sequential fetches, ~200ms apart, with an in-memory page cache.
 *
 * Usage: node scripts/ingest/council.mjs
 */

import { writeSnapshot } from "./shared.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://legistar.council.nyc.gov/";
const OUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/server/snapshot/council.json",
);
const DELAY_MS = 200;
/** Earliest Stated Meeting read; the original 12 votes come from 2026-06-11 and 06-30. */
const MIN_MEETING_DATE = Date.UTC(2026, 5, 11);
/** Contested votes are auto-selected from meetings on/after this date. */
const CONTESTED_FROM = "2026-07-01";
const USER_AGENT =
  "TheFullRecord/1.0 (one-off civic-data ingest; contact: tcp@didero.ai)";

/**
 * Matters to include in the snapshot, curated from the agendas of the two
 * meetings (prefer Introductions and the FY2027 budget resolutions; include a
 * couple of ceremonial items, marked "procedural").
 */
const SELECTED_FILES = [
  // Stated Meeting 2026-06-30 (Budget Adoption)
  "Int 0966-2026", // rental assistance voucher program
  "Int 0015-2026", // child care background checks
  "Int 0580-2026", // office of child care and early childhood education
  "Int 0929-2026", // NYPD security-perimeter transparency report
  "Res 0546-2026", // FY2027 expense budget adoption (M 82)
  "Res 0541-2026", // FY2027 capital budget (M 70)
  "Int 0956-2026", // ceremonial street co-namings (procedural)
  "M 0083-2026", // land use call-up motion (procedural)
  // Res 0525-2026 (commemorative) was considered but adopted by voice vote,
  // so it has no per-member roll call.
  // Stated Meeting 2026-06-11
  "Int 0055-2026", // signage describing constitutional/legal protections
  "Int 0821-2026", // non-digital access to aging-department services
  "Int 0579-2026", // early childhood education enrollment outreach
  "Res 0524-2026", // FY2026 budget modification (MN-8)
];

/**
 * Major matters since July 1 that passed with no "No" or "Abstain" (housing,
 * zoning, tax and cost-of-living, transit fares, ethics, small business).
 * Contested Introductions and Land Use items are added automatically.
 */
const MAJOR_UNANIMOUS_FILES = [
  "Int 0978-2026", // senior rent-increase exemption income limit
  "Int 1015-2026", // tax abatement for multiple-dwelling alterations
  "Int 0685-2026", // office of insurance affordability
  "Int 0692-2026", // paraprofessional workforce stabilization payments
  "Int 0398-2026", // annual financial-interest disclosure
  "Int 0248-2026", // Fair Fares enrollment
  "Int 0813-2026", // tobacco retail license enforcement
  "Int 0547-2026", // added-sugar warning labels
  "Int 0917-2026", // sidewalk/roadway cafe cleanliness
  "Int 0799-2026", // small-retail support fund (roadway construction)
  "Int 0833-2026", // buildings on Eastern Parkway
  "Int 0246-2026", // commissary funds on release
  "LU 0147-2026", // Gowanus Green A (housing)
  "LU 0146-2026", // Fordham Bedford Cluster Phase 1 (housing)
  "LU 0135-2026", // Sojourner Truth - Mapes rezoning
  "LU 0117-2026", // Flatiron NoMad major concessions
  "LU 0067-2026", // Monitor Point rezoning
  "LU 0072-2026", // Dewitt Clinton Park North rezoning
  "LU 0142-2026", // 1455 Coney Island Avenue rezoning
  "LU 0100-2026", // 2950 West 24th Street rezoning
];

/** Titles matching these patterns are ceremonial/procedural, not substantive. */
const PROCEDURAL_RE =
  /\bnaming of\b|\bco-naming\b|commemorat|celebrat|\bdeclaring\b.*\b(day|month|week)\b|minutes of the stated meeting/i;

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

const pageCache = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastFetchAt = 0;

async function fetchPage(url, form) {
  const abs = new URL(url, BASE).href;
  const cacheKey = form ? `${abs}#${form.get("__EVENTTARGET")}` : abs;
  if (pageCache.has(cacheKey)) return pageCache.get(cacheKey);
  const wait = lastFetchAt + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastFetchAt = Date.now();
  process.stderr.write(`  fetch ${abs}\n`);
  const res = await fetch(abs, {
    method: form ? "POST" : "GET",
    body: form,
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${abs}`);
  const html = await res.text();
  pageCache.set(cacheKey, html);
  return html;
}

// ---------------------------------------------------------------------------
// HTML helpers (the InSite pages are table soup; regex is adequate and keeps
// this script dependency-free)
// ---------------------------------------------------------------------------

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(amp|lt|gt|quot|nbsp);|&#39;/g, (m) => ENTITIES[m] ?? m);
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Rows of a Telerik RadGrid: `<tr class="rgRow|rgAltRow" ...>...</tr>`. */
function gridRows(html) {
  return html.match(/<tr class="rg(?:Row|AltRow)"[\s\S]*?<\/tr>/g) ?? [];
}

/** Cells of a row as [{ text, html }]. */
function rowCells(rowHtml) {
  const cells = rowHtml.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? [];
  return cells.map((c) => ({ html: c, text: stripTags(c) }));
}

function firstLink(html, page) {
  const m = html.match(new RegExp(`${page}\\.aspx\\?[^"'\\\\)]+`));
  if (!m) return null;
  // Links inside onclick="radopen('HistoryDetail.aspx?...', ...)" handlers end
  // at an HTML-encoded quote; trim it and anything after.
  const raw = m[0].split("&#39;")[0];
  return new URL(decodeEntities(raw), BASE).href;
}

// ---------------------------------------------------------------------------
// Member roster (MainBody.aspx)
// ---------------------------------------------------------------------------

async function fetchMembers() {
  const html = await fetchPage("MainBody.aspx");
  const members = [];
  for (const row of gridRows(html)) {
    const cells = rowCells(row);
    if (cells.length < 2 || !row.includes("PersonDetail.aspx")) continue;
    const name = cells[0].text;
    const districtMatch = cells[1].text.match(/District (\d+)/);
    if (!name || !districtMatch) continue;
    const url = firstLink(cells[0].html, "PersonDetail");
    const personId = url?.match(/ID=(\d+)/)?.[1] ?? null;
    // The roster grid's last column is political party ("Democrat"/"Republican").
    const partyText = cells.at(-1).text;
    const party =
      partyText === "Democrat" ? "D" : partyText === "Republican" ? "R" : null;
    members.push({
      district: Number(districtMatch[1]),
      name,
      party,
      legistarPersonUrl: url,
      personId, // internal join key; stripped before writing
    });
  }
  members.sort((a, b) => a.district - b.district);
  return members;
}

// ---------------------------------------------------------------------------
// Meetings (Calendar.aspx -> MeetingDetail.aspx)
// ---------------------------------------------------------------------------

/** Stated Meetings held on or after MIN_MEETING_DATE (the calendar is paged 100 rows at a time). */
async function findStatedMeetings() {
  const first = await fetchPage("Calendar.aspx");
  const hidden = (n) => decodeEntities(first.match(new RegExp(`id="${n}" value="([^"]*)"`))?.[1] ?? "");
  const targets = [...first.matchAll(/__doPostBack\(&#39;(ctl00\$ContentPlaceHolder1\$gridCalendar\$ctl00\$ctl02\$ctl00\$ctl\d+)&#39;/g)].map((m) => m[1]);
  const meetings = new Map();
  let oldest = Infinity;
  for (let i = 0; i < targets.length && oldest >= MIN_MEETING_DATE; i++) {
    const html =
      i === 0
        ? first
        : await fetchPage(
            "Calendar.aspx",
            new URLSearchParams({
              __EVENTTARGET: targets[i],
              __EVENTARGUMENT: "",
              __VIEWSTATE: hidden("__VIEWSTATE"),
              __VIEWSTATEGENERATOR: hidden("__VIEWSTATEGENERATOR"),
              __EVENTVALIDATION: hidden("__EVENTVALIDATION"),
            }),
          );
    for (const row of gridRows(html)) {
      const text = stripTags(row);
      const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (dateMatch) {
        const [, mo, day, yr] = dateMatch.map(Number);
        oldest = Math.min(oldest, Date.UTC(yr, mo - 1, day));
      }
      if (!row.includes("City Council Stated Meeting")) continue;
      const url = firstLink(row, "MeetingDetail");
      if (!dateMatch || !url) continue;
      if (/Deferred/i.test(text)) continue; // deferred meetings never convened
      const [, mo, day, yr] = dateMatch.map(Number);
      const date = new Date(Date.UTC(yr, mo - 1, day));
      if (date.getTime() > Date.now() || date.getTime() < MIN_MEETING_DATE) continue;
      meetings.set(isoDate(date), { date, url });
    }
  }
  return [...meetings.values()].sort((a, b) => b.date - a.date);
}

/**
 * Agenda rows on MeetingDetail.aspx have 11 cells:
 * 0 file (LegislationDetail link), 1 version, 2 sponsor, 3 (blank),
 * 4 agenda note, 5 short title, 6 type, 7 long summary,
 * 8 action, 9 result, 10 "Action details" (HistoryDetail link in onclick).
 * We keep the "Approved [,] by Council" row for each matter (the floor vote).
 */
async function fetchMeetingMatters(meeting) {
  const html = await fetchPage(meeting.url);
  const matters = new Map();
  for (const row of gridRows(html)) {
    const cells = rowCells(row);
    if (cells.length < 11) continue;
    const file = cells[0].text;
    if (!/^(Int|Res|M|LU|T)\s?\d/.test(file)) continue;
    if (!/^(Approved|Disapproved),? by Council/.test(cells[8].text)) continue;
    const historyUrl = firstLink(cells[10].html, "HistoryDetail");
    if (!historyUrl || matters.has(file)) continue;
    matters.set(file, {
      file,
      title: cells[5].text,
      type: cells[6].text,
      longSummary: cells[7].text,
      result: cells[9].text,
      action: cells[8].text,
      sourceUrl: firstLink(cells[0].html, "LegislationDetail"),
      historyUrl,
      meetingDate: meeting.date,
    });
  }
  return matters;
}

// ---------------------------------------------------------------------------
// Roll calls (HistoryDetail.aspx)
// ---------------------------------------------------------------------------

function mapVote(value) {
  const v = value.trim().toLowerCase();
  if (v === "affirmative") return "yes";
  if (v === "negative") return "no";
  if (v === "abstain") return "present";
  // Absent, Excused, Medical, Maternity, Paternity, Jury Duty, Non-voting, ...
  return "absent";
}

/** Per-member votes from the gridVote table: [{ personId, name, vote }]. */
async function fetchRollCall(historyUrl) {
  const html = await fetchPage(historyUrl);
  const voteTable = html.match(
    /id="ctl00_ContentPlaceHolder1_gridVote[\s\S]*?<\/table>/,
  )?.[0];
  if (!voteTable) return { votes: [], tally: null };
  const votes = [];
  for (const row of gridRows(voteTable)) {
    const cells = rowCells(row);
    if (cells.length < 2) continue;
    const url = firstLink(cells[0].html, "PersonDetail");
    votes.push({
      personId: url?.match(/ID=(\d+)/)?.[1] ?? null,
      name: cells[0].text,
      vote: mapVote(cells[1].text),
    });
  }
  // e.g. "Votes (46:5)" or "Consent Votes (51:0)" above the table
  const tallyMatch = stripTags(html).match(/Votes \((\d+):(\d+)\)/);
  const tally = tallyMatch
    ? { yes: Number(tallyMatch[1]), no: Number(tallyMatch[2]) }
    : null;
  return { votes, tally };
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function dateLabel(d) {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** Budget resolutions arrive as ALL-CAPS paragraphs; fold to sentence case. */
function deShout(raw) {
  const t = raw.replace(/\s+/g, " ").trim();
  const letters = t.replace(/[^a-zA-Z]/g, "");
  if (letters.length <= 20 || letters.replace(/[^A-Z]/g, "").length / letters.length <= 0.8) {
    return t;
  }
  return (t.charAt(0) + t.slice(1).toLowerCase())
    .replace(/\bnew york\b/g, "New York")
    .replace(/\b(fy|mn|lu|nyc)\b/g, (m) => m.toUpperCase());
}

/** Long agenda titles -> card title. */
function cardTitle(raw) {
  let t = deShout(raw);
  if (t.length > 120) {
    t = t.slice(0, 120).replace(/[,;:\s]+\S*$/, "") + "…";
  }
  return t;
}

/** One neutral, factual sentence from the matter's own summary/title text. */
function summarySentence(matter) {
  let source = matter.longSummary || matter.title;
  // Legistar's long summaries can open with a single run-on sentence; fall
  // back to the matter title when the first sentence is not card-sized.
  const firstOfLong = source.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? source;
  if (firstOfLong.length > 240) source = matter.title;
  source = deShout(source);
  // First sentence (Legistar Int summaries start "This bill would ...").
  const first = source.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? source;
  let s = first.replace(/\s+/g, " ").trim();
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}

function buildRollCall(matter, memberByPersonId, memberByName, warnings) {
  const votes = {};
  const counts = { yes: 0, no: 0, absent: 0, present: 0 };
  for (const v of matter.rollCall.votes) {
    const member =
      (v.personId && memberByPersonId.get(v.personId)) ||
      memberByName.get(v.name.replace(/\s+/g, " ").trim());
    if (!member) {
      warnings.push(`${matter.file}: no district for voter "${v.name}"`);
      continue;
    }
    votes[String(member.district)] = v.vote;
    counts[v.vote] += 1;
  }

  const passed = matter.result === "Pass";
  // "Disapproved by Council" on a land-use item is the Council voting to reject it.
  const verb = /^Disapproved/.test(matter.action ?? "") ? "Disapproved" : passed ? "Passed" : "Failed";
  const outcome = `${verb} ${counts.yes}–${counts.no}`;

  // Cross-check our counts against the tally printed on the page.
  const t = matter.rollCall.tally;
  if (t && (t.yes !== counts.yes || t.no !== counts.no)) {
    warnings.push(
      `${matter.file}: counted ${counts.yes}:${counts.no} but page tally says ${t.yes}:${t.no}`,
    );
  }

  // Loader schema (src/server/live/snapshot.ts): id + bill, votes keyed by
  // district string, summarySource marks the summary as official LRS text.
  const slug = matter.file.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    id: `council-${slug}`,
    bill: matter.file,
    title: cardTitle(matter.title),
    summary: summarySentence(matter),
    summarySource: "official",
    kind:
      matter.type === "Land Use Call-Up" || PROCEDURAL_RE.test(matter.title)
        ? "procedural"
        : "substantive",
    outcome,
    date: isoDate(matter.meetingDate),
    dateLabel: dateLabel(matter.meetingDate),
    sourceUrl: matter.sourceUrl,
    votes: Object.fromEntries(
      Object.entries(votes).map(([k, v]) => [String(k), v])
    ),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const warnings = [];

  process.stderr.write("Fetching member roster (MainBody.aspx)...\n");
  const members = await fetchMembers();
  const memberByPersonId = new Map(members.map((m) => [m.personId, m]));
  const memberByName = new Map(members.map((m) => [m.name, m]));

  process.stderr.write("Finding the last two held Stated Meetings...\n");
  const meetings = await findStatedMeetings();
  for (const m of meetings) process.stderr.write(`  ${isoDate(m.date)}\n`);

  const mattersByFile = new Map();
  for (const meeting of meetings) {
    process.stderr.write(`Reading agenda for ${isoDate(meeting.date)}...\n`);
    for (const [file, matter] of await fetchMeetingMatters(meeting)) {
      if (!mattersByFile.has(file)) mattersByFile.set(file, matter);
    }
  }

  const rollCalls = [];
  // Also every Introduction / Land Use item from July 1 on whose roll call has a
  // "No" or "Abstain"; unanimous ones are kept only if listed in SELECTED_FILES.
  const keep = new Set([...SELECTED_FILES, ...MAJOR_UNANIMOUS_FILES]);
  const candidates = new Set(keep);
  for (const [file, matter] of mattersByFile) {
    if (/^(Int|LU)\s?\d/.test(file) && isoDate(matter.meetingDate) >= CONTESTED_FROM) candidates.add(file);
  }
  const unanimous = [];
  for (const file of candidates) {
    const matter = mattersByFile.get(file);
    if (!matter) {
      warnings.push(`selected matter ${file} not found on either agenda`);
      continue;
    }
    process.stderr.write(`Roll call for ${file}...\n`);
    matter.rollCall = await fetchRollCall(matter.historyUrl);
    if (matter.rollCall.votes.length === 0) {
      warnings.push(`${file}: no recorded roll call, skipping`);
      continue;
    }
    if (!keep.has(file) && !matter.rollCall.votes.some((v) => v.vote === "no" || v.vote === "present")) {
      unanimous.push(`${isoDate(matter.meetingDate)} ${file} ${matter.title.slice(0, 110)}`);
      continue;
    }
    rollCalls.push(buildRollCall(matter, memberByPersonId, memberByName, warnings));
  }
  rollCalls.sort((a, b) => b.date.localeCompare(a.date) || a.bill.localeCompare(b.bill));

  if (process.env.COUNCIL_DRY) {
    console.log(`UNANIMOUS (${unanimous.length}):\n${unanimous.join("\n")}`);
    console.log(`CONTESTED/SELECTED: ${rollCalls.length}`);
    for (const rc of rollCalls) console.log(rc.date, rc.bill, rc.outcome, rc.title.slice(0, 90));
    return;
  }

  // ---- validation ---------------------------------------------------------
  const districts = new Set(members.map((m) => m.district));
  for (let d = 1; d <= 51; d++) {
    if (!districts.has(d)) warnings.push(`district ${d} missing from roster`);
  }
  if (members.length !== 51) warnings.push(`expected 51 members, got ${members.length}`);
  for (const rc of rollCalls) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rc.date) || Number.isNaN(Date.parse(rc.date))) {
      warnings.push(`${rc.bill}: bad date ${rc.date}`);
    }
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    chamber: "NYC COUNCIL",
    sourceLabel: "Roll call · NYC Council",
    members: members.map((m) => {
      const out = { ...m, key: String(m.district), district: String(m.district) };
      delete out.personId;
      return out;
    }),
    rollCalls,
  };

  await writeSnapshot(OUT_PATH, snapshot);

  // ---- summary ------------------------------------------------------------
  console.log(`\nWrote ${OUT_PATH}`);
  console.log(`Members: ${snapshot.members.length} (districts 1-51 ${districts.size === 51 ? "all present" : "INCOMPLETE"})`);
  console.log(`Meetings: ${meetings.map((m) => isoDate(m.date)).join(", ")}`);
  console.log(`Roll calls: ${rollCalls.length}`);
  for (const rc of rollCalls) {
    const c = { yes: 0, no: 0, absent: 0 };
    for (const v of Object.values(rc.votes)) c[v] += 1;
    console.log(
      `  ${rc.date}  ${rc.bill.padEnd(14)} ${rc.kind.padEnd(11)} ${rc.outcome.padEnd(13)} (yes ${c.yes} / no ${c.no} / absent ${c.absent})  ${rc.title}`,
    );
  }
  if (warnings.length) {
    console.log(`\nWarnings (${warnings.length}):`);
    for (const w of warnings) console.log(`  - ${w}`);
  } else {
    console.log("\nNo warnings; all tallies consistent.");
  }
}

await main();
