/**
 * Utah 2025 and 2026 General Session floor votes from the Legislature's own site (le.utah.gov).
 * Replaces the sampled Open States files state-ut-{lower,upper}.json with every House and Senate floor
 * roll call, plus the bill's official General Description / Highlighted Provisions as the summary.
 *
 * Sources (no API key):
 *   /data/{session}/billlist.json   every bill number of the session
 *   /data/{session}/{BILL}.json     bill detail: titles, provisions, actionHistoryList (voteID, voteHouse, voteStr)
 *   /DynaBill/svotes.jsp?sessionid=..&voteid=..&house=H|S   the per-member roll call page
 * Floor votes are the actions with voteHouse H/S and voiceVote "0" (committee votes have no voteHouse; voice
 * votes have no member list). Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/ut.csv
 * (chamber + family name + first initial, district from the page link breaks ties), with Open States' retired list
 * as the fallback for members who left. Votes by people who cannot be linked are dropped.
 * "Absent or not voting" is stored as "absent". The server's certificate chain is incomplete, so le.utah.gov is
 * fetched with `curl -k`; every response is cached in --work so reruns make no requests (<= 3/second otherwise).
 *
 * Run: node scripts/ingest/ut-leg.mjs [--work dir]
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, sleep, writeSnapshot } from "./shared.mjs";
import { billSummary, classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const BASE = "https://le.utah.gov";
const ROSTER_URL = "https://data.openstates.org/people/current/ut.csv";
const SESSIONS = ["2025GS", "2026GS"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHAMBER = { H: "lower", S: "upper" };

const args = process.argv.slice(2);
const work = (args.includes("--work") ? args[args.indexOf("--work") + 1] : undefined) ?? join(tmpdir(), "ut-leg");
mkdirSync(work, { recursive: true });

let last = 0;
/** Cached GET of a le.utah.gov path (curl -k: broken certificate chain), at most ~3 requests/second. */
async function get(path, name) {
  const file = join(work, name);
  if (existsSync(file)) return readFileSync(file, "utf8");
  for (let attempt = 0; ; attempt++) {
    last = Math.max(last + 350, Date.now()); // reserve a slot so concurrent workers still total <= 3 requests/second
    const wait = last - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const body = await new Promise((resolve, reject) =>
        execFile("curl", ["-sk", "--max-time", "30", "-A", "Mozilla/5.0 (thefullrecord-ingest; civic transparency)", "-w", "\n%{http_code}", BASE + path],
          { maxBuffer: 64e6 }, (e, out) => (e ? reject(e) : resolve(out))));
      const code = body.slice(body.lastIndexOf("\n") + 1);
      const text = body.slice(0, body.lastIndexOf("\n"));
      if (code !== "200" || /<title>40[34]/.test(text.slice(0, 2000))) throw new Error(`${path} -> ${code}`);
      writeFileSync(file, text);
      return text;
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

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
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

// --- Roster: current members, plus Open States' retired list for people who have left.
const people = csv(await (await politeGet(ROSTER_URL)).text());
const candidates = (chamber) => [
  ...people.filter((p) => p.current_chamber === chamber).map((p) => ({ id: p.id, last: norm(p.family_name), first: norm(p.given_name), district: p.current_district })),
];
const retired = [];
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/ut/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (m) { const parts = m[1].split("-"); retired.push({ id: `ocd-person/${m[2]}`, first: norm(parts[0]), last: norm(parts[parts.length - 1]) }); }
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const roster = { lower: candidates("lower"), upper: candidates("upper") };

/** "Maloy, A. Cory" + chamber + district from the page link -> person id (null when unknown/ambiguous). */
function resolve(chamber, name, district) {
  const [lastRaw, firstRaw = ""] = name.split(/,\s*/);
  const last = norm(lastRaw), initials = firstRaw.split(/[\s.]+/).filter(Boolean).map((w) => norm(w)[0]); // "A. Cory" may be filed under either name
  const hits = roster[chamber].filter((c) => c.last === last && (!initials.length || initials.includes(c.first[0])));
  if (hits.length === 1) return hits[0].id;
  if (hits.length > 1) { const d = hits.filter((c) => c.district === district); if (d.length === 1) return d[0].id; return null; }
  const old = retired.filter((c) => c.last === last && (!initials.length || initials.includes(c.first[0])));
  return old.length === 1 ? old[0].id : null;
}

/** Parse a svotes.jsp page into {result, positions: [[name, district, "yes"|"no"|"absent"]]}. */
function parseVotePage(html) {
  const result = /\b(Passed|Failed)\b/i.exec(html.replace(/<[^>]*>/g, " "))?.[1]?.toLowerCase();
  const positions = [];
  const sections = html.split(/<font face="Arial" size="5">/).slice(1);
  for (const sec of sections) {
    const head = /^([^<]*)/.exec(sec)[1];
    const pos = /^Yeas|^Ayes/i.test(head) ? "yes" : /^Nays/i.test(head) ? "no" : /^Absent|^Excused|^Not voting/i.test(head) ? "absent" : null;
    if (!pos) continue;
    for (const m of sec.matchAll(/<td>[\s\S]*?<\/td>/g)) {
      const district = /dist=(\d+)/.exec(m[0])?.[1];
      const name = decodeXml(m[0]);
      if (name) positions.push([name, district, pos]);
    }
  }
  return { result, positions };
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const unmatched = new Map(); const skipped = {}; let tallyMismatch = 0;
const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };

for (const session of SESSIONS) {
  const list = JSON.parse(await get(`/data/${session}/billlist.json`, `${session}-billlist.json`));
  console.log(`${session}: ${list.length} bills`);
  // Warm the cache with 3 concurrent workers (latency, not the rate cap, is the bottleneck); the loop below then reads from disk.
  let next = 0;
  await Promise.all([0, 1, 2].map(async () => {
    while (next < list.length) {
      const { number } = list[next++];
      if (next % 200 === 0) console.log(`  ${next}/${list.length}`);
      const bill = JSON.parse(await get(`/data/${session}/${number}.json`, `${session}-${number}.json`));
      for (const a of bill.actionHistoryList ?? [])
        if (a.voteID && CHAMBER[a.voteHouse] && a.voiceVote === "0") await get(`/DynaBill/svotes.jsp?sessionid=${session}&voteid=${a.voteID}&house=${a.voteHouse}`, `${session}-${a.voteHouse}${a.voteID}.html`);
    }
  }));
  for (const { number } of list) {
    const bill = JSON.parse(await get(`/data/${session}/${number}.json`, `${session}-${number}.json`));
    const votes = (bill.actionHistoryList ?? []).filter((a) => a.voteID && CHAMBER[a.voteHouse] && a.voiceVote === "0");
    if (!votes.length) continue;
    const title = decodeXml(bill.shortTitle ?? "");
    const provisions = decodeXml(String(bill.highlightedProvisions ?? "").replace(/<hr>\s*<ltbullet>/g, " "));
    const general = decodeXml(bill.generalProvisions ?? "");
    const info = billSummary({ title, abstracts: [{ abstract: [general, provisions].filter(Boolean).join(" ") }] });
    const bn = `${/^[A-Z]+/.exec(number)[0]} ${Number(/\d+/.exec(number)[0])}`;
    for (const a of votes) {
      const chamber = CHAMBER[a.voteHouse];
      const page = parseVotePage(await get(`/DynaBill/svotes.jsp?sessionid=${session}&voteid=${a.voteID}&house=${a.voteHouse}`, `${session}-${a.voteHouse}${a.voteID}.html`));
      if (!title) { skip("no-bill-title"); continue; }
      if (!page.result) { skip("no-result"); continue; }
      const us = /^(\d+)\/(\d+)\/(\d{4})/.exec(a.actionDate); // some actions use M/D/YYYY instead of ISO
      const day = us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : a.actionDate.slice(0, 10);
      const [ayes, noes] = a.voteStr.split("-").map(Number);
      const votesMap = {};
      for (const [name, district, pos] of page.positions) {
        const id = resolve(chamber, name, district);
        if (!id) { unmatched.set(`${chamber}:${name}`, (unmatched.get(`${chamber}:${name}`) ?? 0) + 1); continue; }
        votesMap[id] = pos;
      }
      if (!Object.keys(votesMap).length) { skip("no-matched-voters"); continue; }
      if (page.positions.filter((p) => p[2] === "yes").length !== ayes || page.positions.filter((p) => p[2] === "no").length !== noes) tallyMismatch++;
      const motion = decodeXml(a.description);
      rolls[chamber].push({
        id: `ut-${session}-${a.voteHouse}${a.voteID}`,
        bill: bn,
        title,
        ...(info.summary ? { summary: info.summary, summarySource: info.summarySource } : {}),
        question: motion,
        kind: classify({ motion_text: motion, motion_classification: /passed (2nd|3rd)|2nd & 3rd|concur|final passage/i.test(motion) ? ["passage"] : [] }),
        // The action text ("House/ failed") is authoritative; the page regex can catch an unrelated "Passed".
        outcome: `${(/\b(passed|failed)\b/i.exec(motion)?.[1]?.toLowerCase() ?? page.result) === "passed" ? "Passed" : "Failed"} ${ayes}–${noes}`,
        date: day,
        dateLabel: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`,
        sourceUrl: `${BASE}/DynaBill/svotes.jsp?sessionid=${session}&voteid=${a.voteID}&house=${a.voteHouse}`,
        votes: votesMap,
      });
    }
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const label = snapshotChamberName("ut", chamber);
  await writeSnapshot(join(OUT, `state-ut-${chamber}.json`), {
    generatedAt: now,
    chamber: label,
    sourceLabel: `Roll call · Utah ${chamber === "lower" ? "House" : "Senate"} floor votes (Utah State Legislature)`,
    keyBy: "openstates",
    jurisdiction: "ut",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.filter((r) => r.summary).length} with an official summary`);
}
console.log("skipped:", skipped, "| tally mismatches (before dropping unmapped members):", tallyMismatch);
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
