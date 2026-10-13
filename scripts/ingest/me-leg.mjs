/**
 * Maine 132nd Legislature (2025-26) House and Senate floor roll calls from the Legislature's own published roll-call PDFs.
 * Replaces any sampled Open States files state-me-{lower,upper}.json.
 *
 * Sources (plain GETs; LawMakerWeb is disallowed by robots.txt and is not fetched):
 *   https://legislature.maine.gov/house/Documents/RollCalls?Legislature=132   table: RC #, date, paper, title, motion
 *   https://legislature.maine.gov/house/Documents/RollCallPDF                 links to one PDF per House roll call
 *   https://legislature.maine.gov/132nd-roll-calls                            Senate list: "# n (date) LD/SP/SC - "title" (Motion: ...)" + PDF
 * Each PDF carries the printed tally and every member's position. House PDFs list "Surname, Initials"; Senate PDFs list
 * surnames in Yea/Nay/Abs/Exc columns (read with pypdf layout mode). Members are keyed "ocd-person/<uuid>" via
 * https://data.openstates.org/people/current/me.csv plus Open States' retired list. A roll call whose parsed yes/no counts
 * differ from the printed tally is dropped. Not voting / excused / absent are stored as "absent". Maine publishes no
 * per-vote bill summary on these pages, so no summaries are stored.
 *
 * Needs pypdf: pip install pypdf
 * Cache: --work (default ~/.cache/me-leg); <= 2.5 requests/second.
 * Run: node scripts/ingest/me-leg.mjs [--work dir]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const SITE = "https://legislature.maine.gov";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/me-leg");
mkdirSync(join(work, "pdf"), { recursive: true });

async function page(url, name) {
  const file = join(work, name);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const text = await (await politeGet(url, { minGapMs: 400 })).text();
  writeFileSync(file, text);
  return text;
}
async function pdf(url, name) {
  const file = join(work, "pdf", `${name}.pdf`);
  if (existsSync(file)) return true;
  try {
    writeFileSync(file, Buffer.from(await (await politeGet(url, { minGapMs: 400 })).arrayBuffer()));
    return true;
  } catch (e) { console.warn(`skip ${url}: ${e.message}`); return false; }
}
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const text = (html) => decodeXml(html).replace(/\s+/g, " ").trim();
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

// --- Roster.
const people = csv(await (await politeGet("https://data.openstates.org/people/current/me.csv")).text());
const cands = []; // { id, given, names, chamber (current members only) }
for (const p of people) cands.push({ id: p.id, given: norm(p.given_name), names: new Set([norm(p.family_name), norm(p.family_name.split(" ").at(-1))]), chamber: p.current_chamber });
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/me/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), names: new Set([norm(rest.join("")), norm(rest.at(-1) ?? "")]), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const unmatched = new Map(), ambiguous = new Map();
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
/** Open States id for a vote-sheet surname (+ initials in the House); null (and counted) when unknown or shared by several people. */
function person(chamber, surname, initials) {
  const k = norm(surname), i = norm(initials ?? "")[0];
  const bySurname = cands.filter((c) => c.names.has(k));
  for (const stage of [bySurname.filter((c) => c.chamber === chamber), bySurname.filter((c) => !c.chamber), bySurname.filter((c) => c.chamber && c.chamber !== chamber)]) {
    let ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length > 1 && i) ids = [...new Set(stage.filter((c) => c.given[0] === i).map((c) => c.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { bump(ambiguous, `${chamber}:${surname} ${initials ?? ""}`); return null; }
  }
  return null;
}

// --- House: table (titles) + PDF list.
const table = await page(`${SITE}/house/Documents/RollCalls?Legislature=132`, "house-table.html");
const houseRows = new Map();
for (const tr of table.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
  const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  if (tds.length < 5) continue;
  const rc = Number(text(tds[0]));
  const d = /(\d\d)\/(\d\d)\/(\d{4})/.exec(tds[1]);
  if (!rc || !d) continue;
  houseRows.set(rc, { date: `${d[3]}-${d[1]}-${d[2]}`, paper: text(tds[2]), title: decodeXml(/title="([^"]*)"/.exec(tds[3])?.[1] ?? text(tds[3])), motion: text(tds[4]) });
}
const housePdfs = new Map();
for (const m of (await page(`${SITE}/house/Documents/RollCallPDF`, "house-pdfs.html")).matchAll(/\/house\/Repository\/Documents\/132\/RollCalls\/(\d+)\.(\d+)\.132\w+\.pdf/g)) housePdfs.set(Number(m[2]), m[0]);

// --- Senate list.
const senateRows = new Map();
for (const p of (await page(`${SITE}/132nd-roll-calls`, "senate-list.html")).match(/<p[^>]*>[\s\S]*?<\/p>/g) ?? []) {
  const links = [...p.matchAll(/<a href="([^"]+\.pdf)">([\s\S]*?)<\/a>/g)];
  const lead = text(p); // "# 9 (2-11-25) SC 82 - "title" (Motion: ...)"
  const m = /#\s*(\d+)\s*\((\d+)-(\d+)-(\d{2,4})\)\s*(.*)$/.exec(lead);
  if (!m || !links.length) continue;
  let rest = m[5];
  const motion = /\(\s*Motion:\s*([^)]*)\)?\s*$/i.exec(rest);
  if (motion) rest = rest.slice(0, motion.index);
  const bill = /^((?:LD|[A-Z]{2})\s*\d+)\s*/.exec(rest);
  const title = rest.slice(bill?.[0].length ?? 0).replace(/^\s*-\s*/, "").replace(/^"|"\s*$/g, "").replace(/\s+/g, " ").trim();
  const href = (links.find((l) => Number(text(l[2]).replace(/\D/g, "")) === Number(m[1])) ?? links.at(-1))[1];
  senateRows.set(Number(m[1]), { date: `${m[4].length === 2 ? "20" : ""}${m[4]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`, bill: bill?.[1].replace(/\s+/, " ") ?? "Senate motion", title: title || motion?.[1].trim() || "Senate roll call", motion: motion?.[1].trim() ?? "", href });
}
console.log(`${houseRows.size} House table rows, ${housePdfs.size} House PDFs, ${senateRows.size} Senate list rows`);

// --- Download.
for (const [rc, href] of housePdfs) await pdf(`${SITE}${href}`, `h${rc}`);
for (const [rc, r] of senateRows) await pdf(new URL(r.href, SITE).href, `s${rc}`);
const toText = (mode, prefix) => {
  const files = readdirSync(join(work, "pdf")).filter((f) => f.startsWith(prefix) && f.endsWith(".pdf") && !existsSync(join(work, "pdf", f.replace(/pdf$/, "txt")))).map((f) => join(work, "pdf", f));
  for (let i = 0; i < files.length; i += 200)
    execFileSync("python3", [join(ROOT, "scripts/ingest/pdf-batch.py"), mode, ...files.slice(i, i + 200)], { stdio: "inherit" });
};
toText("plain", "h"); toText("layout", "s");
const read = (name) => { try { return readFileSync(join(work, "pdf", `${name}.txt`), "utf8"); } catch { return null; } };

// --- Parse.
const POS = { Y: "yes", N: "no", X: "absent", E: "absent", P: "absent" };
function parseHouse(t) {
  const tally = /YES:\s*(\d+)\s+NO:\s*(\d+)[^\n]*MOTION:\s*([A-Z ]+)/.exec(t);
  if (!tally) return null;
  const body = t.slice(t.indexOf(tally[0]) + tally[0].length).split(/EXCUSED DAY/)[0].replace(/\s+/g, " ");
  const votes = [];
  const parts = body.split(/(?:^|(?<= ))([YNXE])(?= (?:Mr\. Speaker|[A-Z][A-Za-z'’-]+(?: [A-Za-z'’-]+)? ?, ))/).slice(1);
  for (let i = 0; i < parts.length; i += 2) votes.push([parts[i], parts[i + 1].trim()]);
  const motion = /MOTION:\s*(.*?)\s+VOTES REQUIRED/.exec(t)?.[1] ?? "";
  const date = /DATE:\s*(\d+)\/(\d+)\/(\d{4})/.exec(t);
  return { yes: +tally[1], no: +tally[2], verdict: tally[3].trim(), motion, date: date && `${date[3]}-${date[1].padStart(2, "0")}-${date[2].padStart(2, "0")}`, votes: votes.map(([c, n]) => ({ pos: POS[c], name: n })) };
}
function parseSenate(t) {
  const n = (k) => new RegExp(`${k}:\\s*(\\d+)`).exec(t)?.[1];
  const verdict = /YEA:[\s\S]*?MOTION:\s*([A-Z]+)/.exec(t)?.[1]; // the printed fields run together or swap order on some sheets
  const lines = t.split("\n");
  const h = lines.findIndex((l) => /Yea\s+Nay\s+Abs\s+Exc.*Yea\s+Nay\s+Abs\s+Exc/.test(l));
  if (n("YEA") == null || n("NAY") == null || !verdict || h < 0) return null;
  const cols = [...lines[h].matchAll(/Yea|Nay|Abs|Exc/g)].map((m) => m.index);
  const split = (cols[3] + cols[4]) / 2, POSN = ["yes", "no", "absent", "absent"];
  const votes = [];
  for (const line of lines.slice(h + 1)) {
    let name = null;
    for (const m of line.matchAll(/\S+(?: \S+)*/g)) {
      const s = m[0];
      if (/^TOTALS/.test(s)) continue;
      if (s === "X" && name) {
        const half = m.index < split ? cols.slice(0, 4) : cols.slice(4);
        const c = half.reduce((b, x, i) => (Math.abs(x - m.index) < Math.abs(half[b] - m.index) ? i : b), 0);
        votes.push({ pos: POSN[c], name }); name = null;
      } else if (/^[A-Z][A-Za-z'’ .-]+$/.test(s)) name = s;
    }
  }
  const question = /Question:\s*([\s\S]*?)\n\s*\n/.exec(t)?.[1]?.replace(/\s+/g, " ").trim();
  const d = /DATE:\s*([A-Z][a-z]+)\s+(\d+),\s*(\d{4})/.exec(t); // the PDF date wins: the list page has typos (#86 reads 4-8-24)
  const mo = d && MONTHS.findIndex((x) => d[1].startsWith(x)) + 1;
  return { yes: +n("YEA"), no: +n("NAY"), verdict, question, date: mo ? `${d[3]}-${String(mo).padStart(2, "0")}-${d[2].padStart(2, "0")}` : null, votes };
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const dropped = {}; const drop = (why, id) => { dropped[why] = (dropped[why] ?? 0) + 1; (droppedIds[why] ??= []).push(id); };
const droppedIds = {};
const verdictWord = (v, yes, no) => (/FAIL|REJECT|DEFEAT/.test(v) ? "Failed" : /PREVAIL|PASS|CARRIE|ADOPT|CONFIRM|ENACT|SUSTAIN/.test(v) ? "Passed" : yes > no ? "Passed" : "Failed");
const verdicts = new Set();
function emit(chamber, id, bill, title, motion, question, date, url, r) {
  verdicts.add(r.verdict);
  const votes = {};
  for (const { pos, name } of r.votes) {
    // House sheets print "Mr. Speaker" (Ryan Fecteau, 2025-26); Senate sheets print "Pro Tem Pierce" for the presiding president pro tempore.
    const [surname, initials] = name === "Mr. Speaker" ? ["Fecteau", "R"] : chamber === "lower" ? name.split(/\s*,\s*/) : [name.replace(/^Pro Tem /, "")];
    const pid = person(chamber, surname, initials);
    if (!pid) { bump(unmatched, `${chamber}:${name}`); continue; }
    votes[pid] = pos;
  }
  const yes = Object.values(votes).filter((v) => v === "yes").length, no = Object.values(votes).filter((v) => v === "no").length;
  if (yes !== r.yes || no !== r.no || r.votes.filter((v) => v.pos === "yes").length !== r.yes) return drop(`${chamber}-tally-mismatch`, `${id} parsed ${yes}-${no} printed ${r.yes}-${r.no}`);
  rolls[chamber].push({
    id, bill, title, question: question || undefined,
    kind: classify({ motion_text: motion, motion_classification: /PASSAGE|ENACT|FINAL|ADOPT/i.test(motion) ? ["passage"] : [] }),
    outcome: `${verdictWord(r.verdict, r.yes, r.no)} ${r.yes}–${r.no}`,
    date, dateLabel: `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`,
    sourceUrl: url, votes,
  });
}
for (const [rc, href] of housePdfs) {
  const t = read(`h${rc}`); const r = t && parseHouse(t);
  if (!r) { drop("house-unparsed", rc); continue; }
  const row = houseRows.get(rc);
  const head = /ROLL CALL NO\. (\d+)\s+MAINE HOUSE OF REPRESENTATIVES\s+([\s\S]*?)\s+DATE:/.exec(t.replace(/\r/g, ""));
  if (head && Number(head[1]) !== rc) { drop("house-rc-mismatch"); continue; }
  const date = r.date ?? row?.date;
  if (!date) { drop("house-no-date"); continue; }
  const ld = /^(LD \d+)\s+(.*)$/s.exec(head?.[2].replace(/\s+/g, " ") ?? "");
  const bill = ld?.[1] ?? row?.paper ?? "House paper";
  emit("lower", `me-h${rc}`, bill, row?.title || ld?.[2] || head?.[2] || bill, r.motion, row?.motion || r.motion, date, `${SITE}${href}`, r);
}
for (const [rc, s] of senateRows) {
  const t = read(`s${rc}`); const r = t && parseSenate(t);
  if (!r) { drop("senate-unparsed", rc); continue; }
  emit("upper", `me-s${rc}`, s.bill, s.title, s.motion, [s.motion, r.question].filter(Boolean).join(" — "), r.date ?? s.date, new URL(s.href, SITE).href, r);
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id, "en", { numeric: true }));
  await writeSnapshot(join(OUT, `state-me-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("me", chamber),
    sourceLabel: `Roll call · Maine ${chamber === "lower" ? "House" : "Senate"} floor votes (Maine Legislature)`,
    keyBy: "openstates",
    jurisdiction: "me",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.at(-1)?.date} to ${list[0]?.date}`);
}
console.log("dropped:", dropped, "| verdict words:", [...verdicts]);
console.log("ambiguous (votes dropped):", Object.fromEntries(ambiguous));
console.log("unmatched members (votes dropped):", Object.fromEntries(unmatched));
console.log("dropped ids:", JSON.stringify(droppedIds));
