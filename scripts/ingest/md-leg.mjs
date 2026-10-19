/**
 * Maryland 2025 and 2026 Regular Session House and Senate floor roll calls from the General Assembly's own
 * published per-vote PDFs. Replaces the sampled Open States files state-md-{lower,upper}.json.
 *
 * Source (plain GETs, no listing page needed): https://mgaleg.maryland.gov/{2025RS|2026RS}/votes/{house|senate}/NNNN.pdf
 * NNNN is the chamber's sequential vote number ("SEQ NO."), so each chamber/session is walked from 1 until 80
 * consecutive numbers 404 (a few low numbers 404 as well). Each one-page PDF prints the tally ("132 Yeas 0 Nays 7 Not
 * Voting 0 Excused 2 Absent"), the bill, sponsor, short title, and every member under Voting Yea / Nay / Not Voting /
 * Excused / Excused (Absent). Votes without a bill (citations, ceremonial) are skipped. Members are keyed
 * "ocd-person/<uuid>" via https://data.openstates.org/people/current/md.csv plus Open States' retired list. A roll call
 * whose parsed yes/no counts differ from the printed tally is dropped. Not voting / excused / absent are stored as
 * "absent". Maryland prints no per-vote summary, so none is stored.
 *
 * Needs pypdf (PYTHONPATH to a pip --target dir), text extracted by pdf-batch.py.
 * Cache: --work (default ~/.cache/md-leg); about 2.6 requests/second.
 * Run: node scripts/ingest/md-leg.mjs [--work dir] [--download-only]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const SITE = "https://mgaleg.maryland.gov";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SESSIONS = ["2025RS", "2026RS"];
const CHAMBERS = { house: "lower", senate: "upper" };

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/md-leg");
const pdfDir = join(work, "pdf");
mkdirSync(pdfDir, { recursive: true });

// --- Download. A 404 is cached as an empty file so reruns do not refetch it.
const files = []; // { ses, ch, n, base }
for (const ses of SESSIONS) for (const ch of Object.keys(CHAMBERS)) {
  let miss = 0;
  for (let n = 1; n < 5000 && !(n > 150 && miss >= 80); n++) {
    const nnnn = String(n).padStart(4, "0"), base = join(pdfDir, `${ses}-${ch}-${nnnn}`);
    if (!existsSync(`${base}.pdf`)) {
      const res = await politeGet(`${SITE}/${ses}/votes/${ch}/${nnnn}.pdf`, { minGapMs: 380, allow404: true });
      writeFileSync(`${base}.pdf`, res ? Buffer.from(await res.arrayBuffer()) : "");
    }
    if (readFileSync(`${base}.pdf`).length) { miss = 0; files.push({ ses, ch, n, nnnn, base }); } else miss++;
  }
  console.log(`${ses} ${ch}: ${files.filter((f) => f.ses === ses && f.ch === ch).length} PDFs`);
}
if (args.includes("--download-only")) process.exit(0);

const todo = files.filter((f) => !existsSync(`${f.base}.txt`)).map((f) => `${f.base}.pdf`);
for (let i = 0; i < todo.length; i += 200)
  execFileSync("python3", [join(ROOT, "scripts/ingest/pdf-batch.py"), "layout", ...todo.slice(i, i + 200)], { stdio: "inherit" });

// --- Roster.
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
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
const people = csv(await (await politeGet("https://data.openstates.org/people/current/md.csv")).text());
const cands = [];
for (const p of people) cands.push({ id: p.id, given: norm(p.given_name), names: new Set([norm(p.family_name), norm(p.family_name.split(" ").at(-1))]), chamber: p.current_chamber });
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/md/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), names: new Set([norm(rest.join("")), norm(rest.at(-1) ?? "")]), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const unmatched = new Map(), ambiguous = new Map();
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
/** Open States id for a sheet name ("Surname" or "Surname, X."); null (and counted) when unknown or ambiguous. */
function person(chamber, name) {
  const [surname, initials] = name.split(/\s*,\s*/);
  const k = norm(surname), i = norm(initials ?? "")[0];
  const bySurname = cands.filter((c) => c.names.has(k));
  for (const stage of [bySurname.filter((c) => c.chamber === chamber), bySurname.filter((c) => !c.chamber), bySurname.filter((c) => c.chamber && c.chamber !== chamber)]) {
    let ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length > 1 && i) ids = [...new Set(stage.filter((c) => c.given[0] === i).map((c) => c.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { bump(ambiguous, `${chamber}:${name}`); return null; }
  }
  return null;
}

// --- Parse.
const SECTION = /^\s*(Voting Yea|Voting Nay|Not Voting|Excused from Voting|Excused \(Absent\))\s*-\s*(\d+)\s*$/;
const POS = { "Voting Yea": "yes", "Voting Nay": "no", "Not Voting": "absent", "Excused from Voting": "absent", "Excused (Absent)": "absent" };
function parse(t) {
  const lines = t.replace(/\r/g, "").split("\n");
  const tally = /(\d+)\s+Yeas\s+(\d+)\s+Nays\s+(\d+)\s+Not Voting\s+(\d+)\s+Excused\s+(\d+)\s+Absent/.exec(t);
  const ti = lines.findIndex((l) => /\d+\s+Yeas\s+\d+\s+Nays/.test(l));
  const d = /Calendar Date:\s*([A-Z][a-z]{2})\s+(\d+),\s*(\d{4})/.exec(t);
  if (!tally || ti < 0 || !d) return null;
  const votes = [], counts = {};
  let section = null;
  for (const line of lines.slice(ti + 1)) {
    const s = SECTION.exec(line);
    if (s) { section = s[1]; counts[section] = +s[2]; continue; }
    if (!section || /^\s*(\* Indicates|- COPY -)/.test(line)) continue;
    for (const name of line.trim().split(/\s{2,}/)) if (name) votes.push({ pos: POS[section], name, change: name.startsWith("*") });
  }
  for (const v of votes) v.name = v.name.replace(/^\*\s*/, "");
  // Header: lines between the "20xx Regular Session" banner and the tally.
  const bi = lines.findIndex((l) => /Regular Session/.test(l));
  const head = lines.slice(bi + 1, ti).map((l) => l.trim()).filter(Boolean);
  return { yes: +tally[1], no: +tally[2], counts, votes, head, date: `${d[3]}-${String(MONTHS.indexOf(d[1]) + 1).padStart(2, "0")}-${d[2].padStart(2, "0")}`, presiding: /Presiding:\s*(.*?)\s{2,}/.exec(t)?.[1] };
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const dropped = {}, droppedIds = {};
const drop = (why, id) => { dropped[why] = (dropped[why] ?? 0) + 1; (droppedIds[why] ??= []).push(id); };
const mismatchPeople = new Map();

for (const f of files) {
  const chamber = CHAMBERS[f.ch];
  const t = readFileSync(`${f.base}.txt`, "utf8");
  const r = parse(t);
  const id = `md-${f.ses.slice(2, 4)}${f.ch[0]}${f.n}`;
  if (!r) { drop("unparsed", id); continue; }
  // First header line starting with a bill number: "HB 7   Third Reading (HB) Calendar No.6".
  const bi = r.head.findIndex((l) => /^(?:HB|SB|HJ|SJ)\s*\d+\b/.test(l));
  if (bi < 0) { drop("no-bill (citation or other)", id); continue; }
  const m = /^((?:HB|SB|HJ|SJ)\s*\d+)\s*(.*)$/.exec(r.head[bi]);
  const bill = m[1].replace(/\s+/, " ");
  const stage = m[2].trim();
  // Next line is the sponsor / committee ("Delegate X et al   (W&M)"), then the short title, then the question lines.
  const tail = r.head.slice(bi + 2);
  const qi = tail.findIndex((l) => /^(On |Bill is |Favorable|Unfavorable|FLA |Motion|Amendment|Concur|Reconsider|\((Amend|Const|[A-Z&]{2,5})\)|Shall )/i.test(l));
  const title = tail.slice(0, qi < 0 ? tail.length : qi).join(" ").replace(/\s+/g, " ").trim();
  const question = [stage, ...(qi < 0 ? [] : tail.slice(qi))].map((s) => s.replace(/\s+\(\w+\)\s*$/, "").trim()).filter(Boolean).join(" · ").replace(/\s+/g, " ");
  if (!title) { drop("no-title", id); continue; }
  const votes = {};
  for (const { pos, name } of r.votes) {
    const pid = name === "Mr. President" ? person("upper", "Ferguson, W") : person(chamber, name);
    if (!pid) { bump(unmatched, `${chamber}:${name}`); continue; }
    votes[pid] = pos;
  }
  const yes = Object.values(votes).filter((v) => v === "yes").length, no = Object.values(votes).filter((v) => v === "no").length;
  const pyes = r.votes.filter((v) => v.pos === "yes").length, pno = r.votes.filter((v) => v.pos === "no").length;
  if (yes !== r.yes || no !== r.no || pyes !== r.yes || pno !== r.no) { drop(`${chamber}-tally-mismatch`, `${id} parsed ${yes}-${no} (names ${pyes}-${pno}) printed ${r.yes}-${r.no}`); continue; }
  rolls[chamber].push({
    id, bill, title, question: question || undefined,
    kind: classify({ motion_text: question, motion_classification: /Third Reading|Final|Special Order|Concur|Enact/i.test(question) ? ["passage"] : [] }),
    outcome: `${r.yes > r.no ? "Passed" : "Failed"} ${r.yes}–${r.no}`, // majority vote; supermajority/veto questions are not distinguished
    date: r.date, dateLabel: `${MONTHS[Number(r.date.slice(5, 7)) - 1]} ${Number(r.date.slice(8, 10))}, ${r.date.slice(0, 4)}`,
    sourceUrl: `${SITE}/${f.ses}/votes/${f.ch}/${f.nnnn}.pdf`, votes,
  });
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id, "en", { numeric: true }));
  await writeSnapshot(join(OUT, `state-md-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("md", chamber),
    sourceLabel: `Roll call · Maryland ${chamber === "lower" ? "House of Delegates" : "Senate"} floor votes (Maryland General Assembly)`,
    keyBy: "openstates",
    jurisdiction: "md",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.at(-1)?.date} to ${list[0]?.date}`);
}
console.log("dropped:", dropped);
console.log("ambiguous (votes dropped):", Object.fromEntries(ambiguous));
console.log("unmatched members (votes dropped):", Object.fromEntries(unmatched));
console.log("dropped ids:", JSON.stringify(Object.fromEntries(Object.entries(droppedIds).map(([k, v]) => [k, v.slice(0, 40)]))));
