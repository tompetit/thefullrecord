/**
 * New Mexico 2025 and 2026 Regular Session floor votes from the Legislature's own site (https://www.nmlegis.gov).
 * Replaces any sampled Open States files state-nm-{lower,upper}.json with the official per-member roll calls.
 *
 * Source: the open directory listing /Sessions/{25|26} Regular/votes/ holds one text PDF per bill and chamber
 * ({HB0002HVOTE.PDF}, {SB0012SVOTE.PDF}; plus numbered {day}.{rcs}.PDF House copies). NM publishes the chamber's
 * recorded roll call for a bill (final passage or concurrence), not every procedural vote, so that is what is imported.
 * PDFs are parsed by text position (scripts/ingest/nm-pdf.py, needs pypdf: `pip install pypdf`): each member row has an X
 * under a YEA/NAY/PNV/EXC/ABSENT (House) or YES/NO/ABS/EXC/REC (Senate) column. Title comes from the bill page
 * (/Legislation/Legislation?chamber=H&legType=B&legNo=2&year=25). NM publishes no plain-language summary, so none is stored.
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/nm.csv by chamber + surname
 * (+ initials the House adds for shared surnames), then Open States' retired list. Excused, absent and recused are stored as "absent".
 * A roll call is kept only if its parsed Yes/No counts equal the tally printed on the PDF. Files are cached in --work
 * (default ~/.cache/nm-leg); <= 3 requests/second.
 * Run: node scripts/ingest/nm-leg.mjs [--work dir]
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../src/server/snapshot");
const SITE = "https://www.nmlegis.gov";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const POSITION = { YEA: "yes", YES: "yes", NAY: "no", NO: "no", PNV: "present", EXC: "absent", ABSENT: "absent", ABS: "absent", REC: "absent" };

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/nm-leg");
mkdirSync(work, { recursive: true });

/** Cached GET (text or binary file); null on 404. */
async function fetchTo(url, file, binary) {
  if (existsSync(file)) return true;
  const res = await politeGet(url, { allow404: true, minGapMs: 350 });
  if (!res) return false;
  writeFileSync(file, binary ? Buffer.from(await res.arrayBuffer()) : await res.text());
  return true;
}

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

// --- Roster.
const people = csv(await (await politeGet("https://data.openstates.org/people/current/nm.csv")).text());
const cands = []; // { id, given, family, chamber (current members only) }
for (const p of people) cands.push({ id: p.id, given: norm(p.given_name), family: norm(p.family_name), chamber: p.current_chamber });
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/nm/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), family: norm(rest.join("")), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
// Two-letter initials the PDFs print for shared surnames (Josh = Joshua N., Andres = G. Andres, Miguel = Miguel P., Joseph = Joseph F.).
const P = (name) => cands.find((c) => c.id && people.find((p) => p.id === c.id)?.name === name)?.id;
const OVERRIDE = {
  "lower:hernandezjn": P("Josh Hernandez"), "lower:hernandezjf": P("Joseph Hernandez"),
  "lower:garciamp": P("Miguel García"), "lower:garciam": P("Martha Garcia"),
  "lower:romeroga": P("Andrés Romero"), "lower:romeroa": P("Andrea Romero"),
};
const unmatched = new Map(); const ambiguous = new Map();
/** Open States id for a PDF name like "Martinez, A", "Hall II", "SEDILLO-LOPEZ"; null (and counted) when unknown or shared. */
function person(chamber, label) {
  const [sur, ini = ""] = label.replace(/\./g, "").replace(/,?\s+(JR|II|III)$/i, "").replace(/(\w)\s+(II|III)$/i, "$1").split(",").map((s) => s.trim());
  const k = norm(sur), initials = norm(ini);
  if (OVERRIDE[`${chamber}:${k}${initials}`]) return OVERRIDE[`${chamber}:${k}${initials}`];
  const fits = cands.filter((c) => (c.family === k || c.family.endsWith(k) || k.endsWith(c.family)) && (!initials || c.given.startsWith(initials[0])));
  const exact = fits.filter((c) => c.family === k);
  const pool = exact.length ? exact : fits;
  for (const stage of [pool.filter((c) => c.chamber === chamber), pool.filter((c) => !c.chamber), pool.filter((c) => c.chamber && c.chamber !== chamber)]) {
    const ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { ambiguous.set(`${chamber}:${label}`, (ambiguous.get(`${chamber}:${label}`) ?? 0) + 1); return null; }
  }
  return null;
}

// --- Vote files.
const files = []; // { yy, name, bill: {type, no} | null }
for (const yy of ["25", "26"]) {
  const list = join(work, `list-${yy}.html`);
  if (!existsSync(list)) await fetchTo(`${SITE}/Sessions/${yy}%20Regular/votes/`, list, false);
  for (const m of readFileSync(list, "utf8").matchAll(/HREF="\/Sessions\/\d\d%20Regular\/votes\/([^"]+\.pdf)"/gi)) {
    const name = m[1];
    const b = /^([HS])(B|M|JM|JR|R|CR|BO|MO)(\d+)([HS]{1,2})VOTE(\d*)\.pdf$/i.exec(name);
    if (b) files.push({ yy, name, bill: { chamber: b[1].toUpperCase(), type: b[2].toUpperCase().replace(/O$/, ""), no: Number(b[3]) } });
    else if (/^\d+\.\d+\.pdf$/i.test(name)) files.push({ yy, name, bill: null });
  }
}
console.log(`${files.length} vote PDFs listed`);
let n = 0;
for (const f of files) {
  f.path = join(work, `${f.yy}-${f.name}`);
  await fetchTo(`${SITE}/Sessions/${f.yy}%20Regular/votes/${f.name}`, f.path, true);
  if (++n % 200 === 0) console.log(`${n}/${files.length} downloaded`);
}

const parsed = {};
for (let i = 0; i < files.length; i += 40) {
  const batch = files.slice(i, i + 40).filter((f) => existsSync(f.path));
  const out = await new Promise((resolve, reject) =>
    execFile("python3", [join(HERE, "nm-pdf.py"), ...batch.map((f) => f.path)], { maxBuffer: 256e6 }, (e, o) => (e ? reject(e) : resolve(o))));
  Object.assign(parsed, JSON.parse(out));
}

// --- Bill titles from the bill pages.
const titles = {};
async function billTitle(yy, b) {
  const key = `${yy}-${b.chamber}${b.type}${b.no}`;
  if (key in titles) return titles[key];
  const file = join(work, `bill-${key}.html`);
  await fetchTo(`${SITE}/Legislation/Legislation?chamber=${b.chamber}&legType=${b.type}&legNo=${b.no}&year=${yy}`, file, false);
  const t = /lblTitle"><b>([\s\S]*?)<\/b>/.exec(existsSync(file) ? readFileSync(file, "utf8") : "")?.[1];
  const raw = t ? decodeXml(t).replace(/^"+|"+$/g, "").trim() : "";
  const small = new Set(["of", "the", "and", "to", "for", "in", "on", "a", "an", "or", "by", "at", "with", "as"]);
  // Official titles are ALL CAPS; sentence-case them for display.
  titles[key] = raw && raw === raw.toUpperCase() ? raw.toLowerCase().replace(/\b[a-z][a-z'’]*/g, (w, i) => (i > 0 && small.has(w) ? w : w[0].toUpperCase() + w.slice(1))) : raw;
  return titles[key];
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const skipped = {}; const skip = (why, f) => { skipped[why] = (skipped[why] ?? []).concat(f.name); };
const seen = new Set();
const misfiled = [];
const WORD_TYPE = { BILL: "B", MEMORIAL: "M", "JOINT MEMORIAL": "JM", "JOINT RESOLUTION": "JR", RESOLUTION: "R", "CONCURRENT RESOLUTION": "CR" };
/** Bills named in a PDF heading, in order: House "HB 63/ec", "HAFC/HB 2,& 3", "HM17, HM46, HM13/a"; Senate
 *  "SENATE RULES COMMITTEE SUBSTITUTE FOR SENATE BILL 132", "SENATE JOINT RESOLUTION 15, AS AMENDED". */
function headingBills(head) {
  const text = head.slice(head.findIndex((l) => /^RCS#/.test(l)) + 1).join(" ");
  const hits = [];
  for (const a of text.matchAll(/\b(HB|SB|HM|SM|HJM|SJM|HJR|SJR|HCR|SCR|HR|SR)\s*(\d+)/gi))
    hits.push({ at: a.index, chamber: a[1][0].toUpperCase(), type: a[1].slice(1).toUpperCase(), no: Number(a[2]) });
  for (const w of text.matchAll(/\b(HOUSE|SENATE)\s+(BILL|JOINT MEMORIAL|JOINT RESOLUTION|CONCURRENT RESOLUTION|MEMORIAL|RESOLUTION)S?\s+(?:NO\.?\s*)?(\d+)/gi))
    hits.push({ at: w.index, chamber: w[1][0].toUpperCase(), type: WORD_TYPE[w[2].toUpperCase().replace(/\s+/g, " ")], no: Number(w[3]) });
  return hits.sort((x, y) => x.at - y.at).map(({ chamber, type, no }) => ({ chamber, type, no }));
}
// Bill-named files first so numbered copies only add votes that have no bill file.
for (const f of [...files.filter((x) => x.bill), ...files.filter((x) => !x.bill)]) {
  const p = parsed[`${f.yy}-${f.name}`];
  if (!p || p.error) { skip(`parse-error ${p?.error ?? "missing"}`, f); continue; }
  const head = p.head;
  const chamber = head.some((l) => /HOUSE OF REPRESENTATIVES/.test(l)) ? "lower" : head.some((l) => /STATE SENATE/.test(l)) ? "upper" : null;
  const rcs = /RCS#\s*(\d+)/.exec(head.join(" "))?.[1];
  const dm = /DATE:\s*(\d\d)\/(\d\d)\/(\d{2,4})/.exec(head.join(" "));
  if (!chamber || !rcs || !dm) { skip("no-chamber-rcs-date", f); continue; }
  const date = `${dm[3].length === 2 ? "20" + dm[3] : dm[3]}-${dm[1]}-${dm[2]}`;
  const id = `nm-${f.yy}-${chamber === "lower" ? "h" : "s"}-${rcs}`;
  if (seen.has(id)) continue;
  // The heading names the bill actually voted on. Some bill-named files are copies of another bill's roll call
  // (26 Regular: SB0032SVOTE.PDF is RCS# 82 on SB 132, HB0036HVOTE.PDF is RCS# 86 on HB 63), so the heading wins.
  // A heading may list several bills voted together ("HM17, HM46, ... HM2"); the file's own bill is kept when listed.
  const named = headingBills(head);
  const same = (x, y) => x.chamber === y.chamber && x.type === y.type && x.no === y.no;
  let bill = f.bill;
  if (!bill || (named.length && !named.some((x) => same(x, f.bill)))) {
    if (f.bill) misfiled.push(`${f.yy}-${f.name} -> ${named[0].chamber}${named[0].type} ${named[0].no}`);
    bill = named[0];
  }
  if (!bill) { skip("numbered-no-bill", f); continue; }
  // Tally: House prints it in the heading, Senate in a "TOTAL =>" row (YES NO ABS EXC REC).
  let yea, nay;
  const ht = /YEAS:\s*(\d+)\s*NAYS:\s*(\d+)/.exec(head.join(" "));
  if (ht) { yea = Number(ht[1]); nay = Number(ht[2]); }
  else { const row = p.junk.find((j) => j[0]?.startsWith("TOTAL")); if (row) { yea = Number(row[1]); nay = Number(row[2]); } }
  if (yea === undefined) { skip("no-tally", f); continue; }
  const votes = {}; let yes = 0, no = 0;
  for (const [label, col] of p.members) {
    const pos = POSITION[col];
    if (!pos) { skip("bad-column", f); continue; }
    if (pos === "yes") yes++; else if (pos === "no") no++;
    const pid = person(chamber, label);
    if (!pid) { const k = `${chamber}:${label}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
    votes[pid] = pos;
  }
  if (yes !== yea || no !== nay) { skip(`tally-mismatch (parsed ${yes}-${no}, printed ${yea}-${nay})`, f); continue; }
  if (!Object.keys(votes).length) { skip("no-matched-voters", f); continue; }
  seen.add(id);
  // Senate sheets print the official result ("PASSED: 38-0" / "FAILED: ..."); House sheets print none, so the House
  // falls back to the tally (yes > no).
  const printed = /^(PASSED|FAILED)\b/.exec(p.junk.map((j) => j.join(" ")).find((j) => /^(PASSED|FAILED)\b/.test(j)) ?? "")?.[1];
  const passed = printed ? printed === "PASSED" : yea > nay;
  const label = `${bill.chamber}${bill.type} ${bill.no}`;
  const title = await billTitle(f.yy, bill);
  // House PDFs: heading lines after "RCS# n" are bill label, then the motion; Senate: one title line.
  const after = head.slice(head.findIndex((l) => /^RCS#/.test(l)) + 1).filter((l) => !/^YEAS:/.test(l));
  const motion = chamber === "lower"
    ? after.slice(1).map((l) => l.split(/ {2,}/).map((w) => (/^(\S )+\S$/.test(w) ? w.replace(/ /g, "") : w)).join(" ")).join(" ").trim()
    : "";
  const question = chamber === "lower" ? motion : after.join(" ").trim();
  rolls[chamber].push({
    id,
    bill: label,
    title: title || label,
    ...(question ? { question } : {}),
    kind: classify({ motion_text: chamber === "lower" ? motion : "", motion_classification: chamber === "lower" && !/passage|concur|adopt/i.test(motion) ? [] : ["passage"] }),
    outcome: `${passed ? "Passed" : "Failed"} ${yea}–${nay}`,
    date,
    dateLabel: `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`,
    sourceUrl: `${SITE}/Legislation/Legislation?chamber=${bill.chamber}&legType=${bill.type}&legNo=${bill.no}&year=${f.yy}`,
    votes,
  });
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-nm-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("nm", chamber),
    sourceLabel: `Roll call · New Mexico ${chamber === "lower" ? "House" : "Senate"} floor votes (New Mexico Legislature)`,
    keyBy: "openstates",
    jurisdiction: "nm",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list[list.length - 1]?.date}..${list[0]?.date}`);
}
console.log(`bill-named files whose heading names another bill (heading used): ${misfiled.length}`, misfiled);
console.log("skipped:", Object.fromEntries(Object.entries(skipped).map(([k, v]) => [k, v.length > 6 ? `${v.length} files` : v])));
console.log("ambiguous names (votes dropped):", Object.fromEntries(ambiguous));
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
