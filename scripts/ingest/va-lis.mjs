/**
 * Virginia 2025 and 2026 regular-session floor votes from the General Assembly's open LIS data files
 * (https://lis.virginia.gov/ "Data files", published at https://lis.blob.core.windows.net/lisfiles/<session>/).
 * Replaces the sampled Open States files state-va-{lower,upper}.json with every House and Senate floor roll call.
 *
 * Files per session (20251 = 2025, 20261 = 2026), plain CSV GETs:
 *   HISTORY.CSV    bill actions; a floor action whose History_refid is a VOTE id carries the roll call
 *                  (committee votes have refids like H02V2610700 and are skipped)
 *   VOTE.CSV       header-less: vote id, then member-code / Y|N|A|X pairs
 *   Members.csv    LIS member code -> chamber + full name
 *   Summaries.csv  official bill summary (the latest "as passed" text, else "as introduced")
 *   BILLS.CSV      title (Bill_description)
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/va.csv (chamber + family name,
 * first initial to break ties); members who left office fall back to Open States' retired list on full name.
 * Y yes, N no, A (abstain) present, X (not voting) absent.
 *
 * Files are cached in --work (default ~/.cache/va-leg) so re-runs are cheap; ≤3 requests/second.
 * Run: node scripts/ingest/va-lis.mjs [--work dir]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { politeGet, writeSnapshot } from "./shared.mjs";
import { billSummary, classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const BLOB = "https://lis.blob.core.windows.net/lisfiles";
const SESSIONS = ["20251", "20261"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHAMBER = { H: "lower", S: "upper" };
const POSITION = { Y: "yes", N: "no", A: "present", X: "absent" };

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/va-leg");

/** Cached GET returning text. */
async function get(url, name) {
  const file = join(work, name);
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) return readFileSync(file, "utf8");
  const text = await (await politeGet(url, { minGapMs: 350 })).text();
  writeFileSync(file, text);
  return text;
}
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
function csv(text, header = true) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (row.length || cell) { row.push(cell); rows.push(row); }
  if (!header) return rows;
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// --- Roster: LIS member code -> Open States person.
const people = csv(await (await politeGet("https://data.openstates.org/people/current/va.csv")).text());
const retired = new Map(); // ocd-person -> normalized name tokens of the file name (full names incl. middle names and nicknames)
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/va/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (m) retired.set(`ocd-person/${m[2]}`, m[1].toLowerCase().split("-").map(norm));
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const memberPerson = new Map(); // LIS code -> ocd-person id
const memberName = new Map();
for (const s of SESSIONS) {
  for (const m of csv(await get(`${BLOB}/${s}/Members.csv`, `${s}/Members.csv`))) {
    const name = m.MBR_NAME.trim();
    const code = m.MBR_MBRNO.trim();
    memberName.set(code, name);
    if (memberPerson.has(code)) continue;
    // LIS "First M. "Nick" Last, Jr." vs Open States given/family names: every family-name word and the given name must appear in the LIS name.
    const words = new Set(name.split(/[\s-]+/).map(norm).filter(Boolean));
    const chamber = CHAMBER[m.MBR_HOU.trim()];
    const family = (p) => p.family_name.split(/[\s-]+/).every((w) => words.has(norm(w)));
    const fits = (p) => family(p) && (words.has(norm(p.given_name)) || norm(p.given_name)[0] === norm(name)[0]);
    const pick = (list) => (list.length === 1 ? list[0].id : undefined);
    // Members who changed chambers (House -> Senate) are in the current file under the other chamber; then retired members (file name = full name).
    const w = [...words], old = [...retired].filter(([, t]) => t.includes(w[0]) && t.includes(w[w.length - 1]));
    const id = pick(people.filter((p) => p.current_chamber === chamber && fits(p))) ?? pick(people.filter((p) => p.current_chamber === chamber && family(p))) ?? pick(people.filter(fits)) ?? (old.length === 1 ? old[0][0] : undefined);
    if (id) memberPerson.set(code, id);
  }
}

const titles = new Map(); // `${session}:${bill}` -> title
const summaries = new Map(); // `${session}:${bill}` -> { rank, text }
const RANK = { "SUMMARY AS PASSED": 3, "SUMMARY AS PASSED SENATE": 3, "SUMMARY AS PASSED HOUSE": 2, "SUMMARY AS INTRODUCED": 1 };
const stripHtml = (h) => h.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, " ").trim()
  .replace(/(\?{1,2})\s*(?=\d+(?:\.\d+)?-\d)/g, (_, q) => `${"§".repeat(q.length)} `); // the source file stores § as "?"

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const unmatched = new Map(); const skipped = {};const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };

for (const s of SESSIONS) {
  for (const b of csv(await get(`${BLOB}/${s}/BILLS.CSV`, `${s}/BILLS.CSV`))) titles.set(`${s}:${b.Bill_id}`, b.Bill_description.trim());
  for (const r of csv(await get(`${BLOB}/${s}/Summaries.csv`, `${s}/Summaries.csv`))) {
    const rank = RANK[r.SUMMARY_TYPE.trim()] ?? 0;
    const key = `${s}:${r.SUM_BILNO.replace(/^([A-Z]+)0*/, "$1")}`;
    if (rank && rank >= (summaries.get(key)?.rank ?? 0)) summaries.set(key, { rank, text: stripHtml(r.SUMMARY_TEXT) });
  }
  const voteRows = new Map(csv(await get(`${BLOB}/${s}/VOTE.CSV`, `${s}/VOTE.CSV`), false).filter((r) => r.length > 2).map((r) => [r[0], r]));
  for (const h of csv(await get(`${BLOB}/${s}/HISTORY.CSV`, `${s}/HISTORY.CSV`))) {
    const ref = h.History_refid;
    const row = voteRows.get(ref);
    const chamber = CHAMBER[h.History_description[0]];
    if (!row || !chamber || !/^(\d+|SV\d+)$/.test(ref)) continue; // committee votes carry refids like H02V…
    const [mo, d, y] = h.History_date.split("/");
    const day = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    if (day > now.slice(0, 10)) { skip("future-date"); continue; }
    const votes = {}; let yes = 0, no = 0, any = false;
    for (let i = 1; i + 1 < row.length; i += 2) {
      const pos = POSITION[row[i + 1]];
      if (!pos) continue;
      if (pos === "yes") yes++; else if (pos === "no") no++;
      const id = memberPerson.get(row[i]);
      if (!id) { const k = `${chamber}:${memberName.get(row[i]) ?? row[i]}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
      votes[id] = pos; any = true;
    }
    if (!any) { skip("no-matched-voters"); continue; }
    const m = /\((\d+)-Y (\d+)-N/.exec(h.History_description);
    // The vote file occasionally disagrees with the printed tally (re-used ids); drop rather than publish a doubtful roll call.
    if (m && (Number(m[1]) !== yes || Number(m[2]) !== no)) { skip("tally-mismatch"); continue; }
    const title = titles.get(`${s}:${h.Bill_id}`);
    if (!title) { skip("no-bill-title"); continue; }
    const question = h.History_description.replace(/^[HS] /, "").replace(/\s*\(\d+-Y.*$/, "").trim();
    const bi = billSummary({ title, abstracts: [{ abstract: summaries.get(`${s}:${h.Bill_id}`)?.text ?? "" }] });
    const id = `va-${s}-${h.Bill_id}-${ref}`;
    if (rolls[chamber].some((r) => r.id === id)) { skip("duplicate-in-source"); continue; }
    rolls[chamber].push({
      id,
      bill: h.Bill_id.replace(/^([A-Z]+)(\d+)$/, "$1 $2"),
      title,
      ...(bi.summary ? bi : {}),
      question,
      kind: /reading dispensed/i.test(question) ? "procedural" : classify({ motion_text: question, motion_classification: /passed|concurred|agreed to|adopted/i.test(question) && !/amendment|reconsider/i.test(question) ? ["passage"] : [] }),
      outcome: `${yes > no ? "Passed" : "Failed"} ${yes}–${no}`,
      date: day,
      dateLabel: `${MONTHS[Number(mo) - 1]} ${Number(d)}, ${y}`,
      sourceUrl: `https://lis.virginia.gov/bill-details/${s}/${h.Bill_id}`,
      votes,
    });
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-va-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("va", chamber),
    sourceLabel: `Roll call · Virginia ${chamber === "lower" ? "House of Delegates" : "Senate"} floor votes (Virginia Legislative Information System)`,
    keyBy: "openstates",
    jurisdiction: "va",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.filter((r) => r.summary).length} with official summary`);
}
console.log("skipped:", skipped);
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
