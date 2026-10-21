/**
 * Tennessee 114th General Assembly (2025 and 2026 sessions) floor votes from the legislature's own site
 * (https://wapp.capitol.tn.gov/apps/BillInfo). Replaces any sampled Open States files state-tn-{lower,upper}.json with
 * every recorded House and Senate FLOOR roll call (committee and subcommittee votes, and voice votes, are not imported).
 *
 * Page (server-rendered HTML, plain GET): /apps/BillInfo/Default?BillNumber=HB0100&GA=114 carries the bill's abstract,
 * the official Bill Summary, and a Votes tab with a House and a Senate panel. Each recorded vote prints
 * "BILL by Sponsor - FLOOR VOTE: <motion> <m/d/yyyy>", the Ayes/Noes counts, and member lists by SURNAME
 * ("Representatives voting Aye were: ...", "... voting No were: ...", "... present and not voting were: ...").
 * Bill numbers are probed (HB, SB, HJR, SJR; simple resolutions are omitted) by tn-crawl.mjs.
 *
 * The page lists no absentees, so a member of the chamber who is not named is stored as "absent" for roll calls dated
 * between that member's first and last recorded vote in the chamber (so vacancies / not-yet-sworn seats get no position).
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/tn.csv by chamber + surname (the
 * site adds a first initial where two members share a surname, "Hicks G"; "Mr. Speaker X" is the presiding officer),
 * then Open States' retired list, then a current member of the other chamber. A name that fits several people is dropped
 * and reported. A roll call whose listed names do not equal its printed Ayes/Noes/Present counts is dropped and counted.
 *
 * Run: node scripts/ingest/tn-leg.mjs [--work dir]   (cache default ~/.cache/tn-leg; <= 2 requests/second)
 */
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { billSummary, classify, snapshotChamberName } from "./openstates-transform.mjs";
import { bills as crawl } from "./tn-crawl.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/tn-leg");
mkdirSync(work, { recursive: true });

const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const text = (html) => decodeXml(html.replace(/&nbsp;/g, " ")).replace(/\s+/g, " ").trim();
/** Like text() but joins inline tags without a space (the summaries split words across <span>s). */
const flow = (html) => text(html.replace(/<\/p>|<br\s*\/?>/gi, "\n").replace(/<\/?(?:span|b|i|u|em|strong|font)\b[^>]*>/gi, ""));
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

// --- Roster: Open States people (current, then retired) matched by surname (+ first initial).
const people = csv(await (await politeGet("https://data.openstates.org/people/current/tn.csv")).text());
const cands = []; // { id, given, names, chamber (current members only) }
for (const p of people) cands.push({ id: p.id, given: norm(p.given_name), names: new Set([norm(p.family_name), norm(p.family_name.split(" ").at(-1))]), chamber: p.current_chamber });
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/tn/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1 && !/^(jr|sr|ii|iii|iv)$/i.test(t));
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), names: new Set([norm(rest.join("")), norm(rest.at(-1) ?? "")]), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const unmatched = new Map(); const ambiguous = new Map();
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const nameCache = new Map();
/** Open States id for a vote-page name; null (and counted) when unknown or shared by several people. */
function person(chamber, label) {
  const key = `${chamber}:${label}`;
  if (nameCache.has(key)) return nameCache.get(key);
  const clean = label.replace(/^Mr\. Speaker\s+/, "").replace(/^Lt\. Governor\s+/, "");
  const m = /^(.*\S)\s+([A-Z])$/.exec(clean.trim());
  const k = norm(m ? m[1] : clean), initial = m?.[2].toLowerCase();
  const fits = cands.filter((c) => c.names.has(k) && (!initial || c.given[0] === initial));
  let found = null;
  for (const stage of [fits.filter((c) => c.chamber === chamber), fits.filter((c) => !c.chamber), fits.filter((c) => c.chamber && c.chamber !== chamber)]) {
    const ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length === 1) { found = ids[0]; break; }
    if (ids.length > 1) { found = "ambiguous"; break; }
  }
  nameCache.set(key, found);
  return found;
}

const PANELS = [["pnlHouseVotes", "lower"], ["pnlSenateVotes", "upper"]];
const HEADER = /^((?:HB|SB|HJR|SJR)\d{4}) by (.+?) - ([^:]+):\s*(.*)$/;
const DATED = /^(.*?)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/;
const LIST = /^(?:Representatives|Senators) (voting Aye|voting No|present and not voting) were: (.*?)\s*-- (\d+)\.?$/;

/** Parse one panel into floor-vote entries. */
function entries(panelHtml) {
  const lines = panelHtml.replace(/<br\s*\/?>/gi, "\n").replace(/<h3[\s\S]*?<\/h3>/, "").split("\n").map(text).filter(Boolean);
  const out = []; let cur = null;
  for (const line of lines) {
    const h = HEADER.exec(line);
    if (h) { cur = { bill: h[1], committee: h[3].trim(), motion: "", aye: [], no: [], present: [], counts: {} }; out.push(cur); }
    const dated = DATED.exec(h ? h[4] : line);
    if (cur && !cur.y && dated && (h || !cur.result)) { [, cur.motion, cur.m, cur.d, cur.y] = dated; cur.motion = cur.motion.replace(/\s+/g, " ").trim(); }
    if (h || !cur) continue;
    let m;
    if ((m = /^(Passed|Failed|Adopted|Rejected|Not Adopted|Defeated|Tabled)[\s\S]*$/i.exec(line))) cur.result = line;
    else if ((m = /^(Ayes|Noes|Present(?:, not voting| and not voting)?)\.+\s*(\d+)$/.exec(line))) cur.counts[m[1].startsWith("Present") ? "present" : m[1] === "Ayes" ? "aye" : "no"] = Number(m[2]);
    else if ((m = LIST.exec(line))) {
      const names = m[2] ? m[2].split(/,\s*/).map((s) => s.trim()).filter(Boolean) : [];
      if (names.length !== Number(m[3])) cur.badList = true;
      cur[m[1] === "voting Aye" ? "aye" : m[1] === "voting No" ? "no" : "present"].push(...names);
    } else if (/voting (Aye|No) were:|present and not voting were:/.test(line)) cur.badList = true;
  }
  return out.filter((e) => e.committee === "FLOOR VOTE");
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
const seen = new Set(); let pages = 0;
const staged = []; // roll calls with named votes, absences filled in below
for await (const [bill, page] of crawl(work)) {
  if (++pages % 500 === 0) console.log(`${pages} bills parsed`);
  const abstract = flow(/abstract-container[^>]*>([\s\S]*?)(?:<!--|<\/div>)/.exec(page)?.[1] ?? "").replace(/^(.{0,240}\S)\s.*$/s, (m, a) => (m.length > 240 ? `${a}…` : m));
  const summaryHtml = /<h3>Bill Summary<\/h3>([\s\S]*?)(?:<h3>|<\/li>)/.exec(page)?.[1] ?? "";
  const { summary, summarySource } = billSummary({ title: abstract, abstracts: [{ abstract: flow(summaryHtml) }] });
  const caption = text(/id="divCaptionText"[^>]*>([\s\S]*?)<\/div>/.exec(page)?.[1] ?? "");
  for (const [panelId, chamber] of PANELS) {
    const i = page.indexOf(`ID="${panelId}"`);
    if (i < 0) continue;
    const panel = page.slice(i, page.indexOf("</asp:Panel>", i));
    for (const e of entries(panel)) {
      const day = `${e.y}-${e.m.padStart(2, "0")}-${e.d.padStart(2, "0")}`;
      const sig = [chamber, e.bill, day, e.motion, e.aye.join("|"), e.no.join("|")].join("#");
      if (seen.has(sig)) continue;
      seen.add(sig);
      if (!e.counts.aye && e.counts.aye !== 0) { skip("no-counts"); continue; }
      const ayes = e.counts.aye ?? 0, noes = e.counts.no ?? 0, pres = e.counts.present ?? 0;
      if (e.badList || e.aye.length !== ayes || e.no.length !== noes || e.present.length !== pres) { skip("tally-mismatch"); continue; }
      const votes = {};
      let bad = false;
      for (const [names, pos] of [[e.aye, "yes"], [e.no, "no"], [e.present, "present"]]) {
        for (const name of names) {
          const id = person(chamber, name);
          if (id === "ambiguous") { bump(ambiguous, `${chamber}:${name}`); bad = true; continue; }
          if (!id) { bump(unmatched, `${chamber}:${name}`); bad = true; continue; }
          votes[id] = pos;
        }
      }
      if (!Object.keys(votes).length) { skip("no-matched-voters"); continue; }
      if (bad) skip("some-voters-unmatched");
      staged.push({ chamber, day, roll: {
        id: `tn-${e.bill}-${day.replace(/-/g, "")}-${chamber[0]}${seen.size}`,
        bill: e.bill.replace(/^([HS]J?[BR])0*/, "$1 "),
        title: abstract || caption,
        ...(summary ? { summary, summarySource } : {}),
        question: e.motion || undefined,
        kind: classify({ motion_text: e.motion, motion_classification: /passage|third consideration|concur|final|adopt/i.test(e.motion) ? ["passage"] : [] }),
        outcome: `${ayes > noes ? "Passed" : "Failed"} ${ayes}–${noes}`,
        date: day,
        dateLabel: `${MONTHS[Number(e.m) - 1]} ${Number(e.d)}, ${e.y}`,
        sourceUrl: `https://wapp.capitol.tn.gov/apps/BillInfo/Default?BillNumber=${bill}&GA=114`,
        votes,
      } });
    }
  }
}
console.log(`${pages} bills parsed, ${staged.length} floor roll calls with named votes`);

// Absent = member active in the chamber (between their first and last recorded vote there) but not named.
for (const chamber of ["lower", "upper"]) {
  const span = new Map(); // id -> [first, last]
  for (const s of staged) if (s.chamber === chamber) for (const id of Object.keys(s.roll.votes)) {
    const w = span.get(id);
    if (!w) span.set(id, [s.day, s.day]); else { if (s.day < w[0]) w[0] = s.day; if (s.day > w[1]) w[1] = s.day; }
  }
  for (const s of staged) if (s.chamber === chamber) for (const [id, [a, b]] of span) if (!(id in s.roll.votes) && s.day >= a && s.day <= b) s.roll.votes[id] = "absent";
  rolls[chamber] = staged.filter((s) => s.chamber === chamber).map((s) => s.roll);
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-tn-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("tn", chamber),
    sourceLabel: `Roll call · Tennessee ${chamber === "lower" ? "House" : "Senate"} floor votes (Tennessee General Assembly)`,
    keyBy: "openstates",
    jurisdiction: "tn",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  const d = list.map((r) => r.date);
  console.log(`${chamber}: ${list.length} roll calls ${d.at(-1)}..${d[0]}, ${list.filter((r) => r.summary).length} with official summary`);
}
console.log("skipped:", skipped);
console.log("ambiguous names:", Object.fromEntries(ambiguous));
console.log("unmatched names:", Object.fromEntries(unmatched));
