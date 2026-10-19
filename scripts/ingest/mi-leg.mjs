/**
 * Michigan 2025 and 2026 floor votes from the Legislature's own House and Senate Journals.
 * Replaces the sampled Open States files state-mi-{lower,upper}.json with every House and Senate roll call on a bill or
 * joint/concurrent resolution that the journals print with member lists (passage, concurrence, conference reports,
 * roll-called amendments, resolutions, appeals of a ruling of the Chair). Simple resolutions (HR/SR), speaker elections
 * and other non-bill rolls are not imported.
 *
 * Sources (plain GETs of public files):
 *   https://www.legislature.mi.gov/Search/ExecuteSearch?printerFriendly=true&sessions=2025-2026&docTypes=House+Journal  list of journals
 *   (same for "Senate Journal")
 *   https://www.legislature.mi.gov/documents/2025-2026/Journal/{House|Senate}/htm/{YYYY}-{HJ|SJ}-{MM}-{DD}-{NNN}.htm   one HTML per day
 *
 * Journals print "Roll Call No. N  Yeas—K" followed by the names. House: Yeas and Nays only, so members seated on the date
 * who appear in neither list are stored as `absent`. Senate: Yeas, Nays, Excused and Not Voting are all printed. Each list
 * must contain exactly the printed count of names and every name must resolve to exactly one Open States person (chamber +
 * surname, + first initial where the House prints "Carter, B."), seated on that date; otherwise the roll call is dropped and
 * counted. Stored `absent` covers Excused and Not Voting. Journals have no per-vote summary; titles are the bill's official
 * "A bill to ..." title (trimmed).
 *
 * Roster: Open States people (github.com/openstates/people data/mi/{legislature,retired}), cached. Cache: --work (default ~/.cache/mi-leg).
 * Run: node scripts/ingest/mi-leg.mjs [--work dir] [--dry]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const BASE = "https://www.legislature.mi.gov";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/mi-leg");
for (const d of ["hj", "sj", "people"]) mkdirSync(join(work, d), { recursive: true });
const gap = { minGapMs: 350 };
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

// ---------------------------------------------------------------- journals
const days = []; // { chamber, name, date, file, url }
for (const [label, chamber, dir, code] of [["House", "lower", "hj", "HJ"], ["Senate", "upper", "sj", "SJ"]]) {
  const listFile = join(work, dir, "list.html");
  if (!existsSync(listFile)) {
    const url = `${BASE}/Search/ExecuteSearch?printerFriendly=true&sessions=2025-2026&docTypes=${label}+Journal&number=&contentFullText=&dateFrom=&dateTo=`;
    writeFileSync(listFile, await (await politeGet(url, gap)).text());
  }
  const names = [...new Set([...readFileSync(listFile, "utf8").matchAll(/objectName=(20\d\d-[HS]J-\d\d-\d\d-\d+)/g)].map((m) => m[1]))].sort();
  for (const name of names) {
    const file = join(work, dir, `${name}.htm`);
    const url = `${BASE}/documents/2025-2026/Journal/${label}/htm/${name}.htm`;
    if (!existsSync(file)) writeFileSync(file, Buffer.from(await (await politeGet(url, gap)).arrayBuffer()));
    const [y, , m, d] = name.split("-");
    days.push({ chamber, name, date: `${y}-${m}-${d}`, file, url });
  }
}
console.log(`${days.filter((d) => d.chamber === "lower").length} House journals, ${days.filter((d) => d.chamber === "upper").length} Senate journals`);

/** Journal HTML -> text: one line per paragraph; source line wraps become spaces; runs of 2+ spaces (name columns) become tabs. */
function load(d) {
  const buf = readFileSync(d.file);
  let s;
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { s = new TextDecoder("windows-1252").decode(buf); }
  s = s.replace(/^﻿/, "").replace(/\u00a0/g, " ").replace(/\r?\n/g, " ").replace(/<\/p>|<br\s*\/?>|<\/tr>|<\/div>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&rsquo;|&lsquo;/g, "’").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&[a-z]+;/g, " ");
  return s.split("\n").map((l) => l.replace(/[ \t]{2,}|\t/g, "\t").trim()).filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- roster (Open States people)
async function peopleFiles(dir) {
  const cache = join(work, "people", `${dir}.json`);
  if (!existsSync(cache)) {
    const list = await (await politeGet(`https://api.github.com/repos/openstates/people/contents/data/mi/${dir}`, { ...gap, headers: { Accept: "application/vnd.github+json" } })).json();
    writeFileSync(cache, JSON.stringify(list.map((x) => ({ name: x.name, url: x.download_url }))));
  }
  return JSON.parse(readFileSync(cache, "utf8"));
}
const unq = (s) => (s ?? "").replace(/^['"]|['"]$/g, "");
const roster = []; // { id, family keys, given initial, roles }
for (const dir of ["legislature", "retired"]) {
  for (const f of await peopleFiles(dir)) {
    const file = join(work, "people", f.name);
    if (!existsSync(file)) writeFileSync(file, await (await politeGet(f.url, { minGapMs: 250 })).text());
    const y = readFileSync(file, "utf8").split(/\n(?=other_identifiers:|links:|sources:|offices:)/)[0];
    const id = /^id: (\S+)/m.exec(y)?.[1];
    const family = unq(/^family_name: (.+)$/m.exec(y)?.[1]);
    const given = unq(/^given_name: (.+)$/m.exec(y)?.[1]);
    const rolesText = /^roles:\n([\s\S]*?)(?=^(?!- |  )\S)/m.exec(`${y}\nend:`)?.[1] ?? "";
    const roles = rolesText.split(/^- /m).filter(Boolean).map((r) => ({
      type: /type: (\w+)/.exec(r)?.[1], district: /district: '?([^'\n]+)'?/.exec(r)?.[1],
      start: /start_date: '?([\d-]+)/.exec(r)?.[1] ?? "0000", end: /end_date: '?([\d-]+)/.exec(r)?.[1] ?? "9999",
    })).filter((r) => (r.type === "lower" || r.type === "upper") && r.end >= "2024-12-01");
    if (!id || !roles.length) continue;
    const keys = new Set([norm(family), norm(family.split(/[\s-]+/).at(-1)), norm(family.split(/[\s-]+/)[0])]);
    const fileName = f.name.replace(/-[0-9a-f]{8}-[0-9a-f-]{27}\.yml$/, "").split("-"); // "Tonya-Myers-Phillips": journals print the full hyphenated surname
    for (let i = 1; i < fileName.length; i++) keys.add(norm(fileName.slice(i).join("")));
    roster.push({ id, keys, current: dir === "legislature", initial: norm(given)[0] ?? "", roles });
  }
}
console.log(`${roster.length} legislators with a 2025+ role`);
const seatedOn = (chamber, date) => roster.filter((p) => p.roles.some((r) => r.type === chamber && r.start <= date && date <= r.end));

const unmatched = new Map(), ambiguous = new Map();
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
/** Open States id for a journal name ("Carter, B." -> key carter, initial b), or null / "ambiguous". */
function person(chamber, raw, date) {
  const m = /^(.*?)(?:,\s*([A-Z])\.?)?$/.exec(raw.trim());
  const key = norm(m[1]), initial = m[2]?.toLowerCase();
  const fits = (loose) => roster.filter((p) => p.keys.has(key) && (!initial || p.initial === initial)
    && p.roles.some((r) => r.type === chamber && (loose || (r.start <= date && date <= r.end))));
  let c = fits(false);
  if (!c.length) c = fits(true);
  if (c.length > 1 && c.filter((p) => p.current).length === 1) c = c.filter((p) => p.current);
  return c.length === 1 ? c[0].id : c.length ? "ambiguous" : null;
}

/** Some journals separate names with single spaces: greedily join up to 3 tokens ("Carter, B.", "St. Germaine") that name one person. */
function splitNames(chunk, chamber, date) {
  if (person(chamber, chunk, date)) return [chunk];
  const tokens = chunk.split(" "), out = [];
  for (let i = 0; i < tokens.length;) {
    let len = Math.min(3, tokens.length - i);
    while (len > 1 && !person(chamber, tokens.slice(i, i + len).join(" "), date)) len--;
    out.push(tokens.slice(i, i + len).join(" "));
    i += len;
  }
  return out;
}

// ---------------------------------------------------------------- parse
const HEADER = /\b(House|Senate)\s+(Joint\s+|Concurrent\s+)?(Bill|Resolution)\s+No\.\s*(\d+[a-z]?)\s*,?\s*entitled/gi;
const abbr = (m) => `${m[1][0]}${m[2] ? m[2][0] : ""}${m[3][0]}`.toUpperCase() + ` ${m[4].toUpperCase()}`;
const SECTION = /(Yeas|Nays|Excused|Not Voting|Present)\s*[—–-]\s*(\d+)/g;

const rolls = { lower: [], upper: [] };
const drops = {}; const drop = (why, extra) => { drops[why] = (drops[why] ?? 0) + 1; if (DRY && extra) console.log(why.toUpperCase(), extra); };
const found = { lower: 0, upper: 0 };
const seen = new Set();
const trim = (s, n) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(" ", n - 1)).replace(/[,;:\s]+$/, "")}…`);

/** "A bill to amend 1967 PA 281, entitled “Income tax act of 1967,” by amending sections 30..." -> "Income tax act of 1967: amend sections 30..."; other titles trimmed. */
function shortTitle(official) {
  const m = /^A bill to amend (?:\d{4} PA \d+|[^,]*?), entitled [“"]([^”"]+?),?[”"],? (?:\([^)]*\),? )?by (amending|adding|repealing|amending the title and)\s+(.*)$/i.exec(official);
  if (m) return trim(`${m[1]}: ${m[2].replace(/ing$/, "")} ${m[3].replace(/\s*\(MCL.*$/, "").replace(/,? (as|and sections?) (amended|added).*$/, "")}`, 200);
  const body = official.replace(/^A bill to /i, "");
  return trim(body.charAt(0).toUpperCase() + body.slice(1), 200);
}

function describe(lead) {
  const flat = lead.replace(/\s+/g, " ");
  const q = flat.lastIndexOf("The question being");
  const tail = q >= 0 ? flat.slice(q) : flat.slice(-420); // this vote's own question, not earlier motions of the day
  const verdict = tail.split(/(?<=\.) (?=[A-Z])/).findLast((x) => /therefor|as follows/.test(x)) ?? tail;
  const failed = /\bnot (passed|adopted|concurred in|agreed)|not prevail|not stand/i.test(verdict);
  let question, passage = false;
  if (/Chair stand as the judgment|judgment of the (House|Senate)/i.test(tail)) question = "Uphold the ruling of the Chair";
  else if (/conference report/i.test(tail)) { question = "Adopt conference committee report"; passage = true; }
  else if (/concurring in|concurred in/i.test(tail)) question = `Concur in ${/substitute/i.test(tail) ? "substitute" : "amendments"} made by the ${/by the Senate/.test(tail) ? "Senate" : "House"}`;
  else if (/adoption of the (amendments?|substitute)|The (amendments?|substitute) (was|were) (not )?adopted/i.test(tail)) question = /adoption of the substitute|The substitute (was|were)/i.test(tail) ? "Adopt substitute" : "Adopt amendment";
  else if (/adoption of the (concurrent |joint )?resolution|resolution was (not )?adopted/i.test(tail)) { question = "Adopt resolution"; passage = true; }
  else if (/passage of the bill|read a third time and|bill was (then )?(not )?passed|petition was then passed/i.test(tail)) { question = "Third reading and passage"; passage = true; }
  else question = trim(tail.replace(/,? (by yeas and nays,? )?as follows:?\s*$/, ""), 160);
  return { question, failed, passage };
}

for (const d of days) {
  const text = load(d);
  const chamber = d.chamber;
  const year = d.date.slice(0, 4);
  const headers = [...text.matchAll(HEADER)].map((m) => ({ pos: m.index, end: m.index + m[0].length, bill: abbr(m) }));
  let floor = 0;
  const blocks = [...text.matchAll(/Roll\s+Call\s+No\.\s*(\d+)\s*Yeas\s*[—–-]\s*\d+/g)];
  found[chamber] += blocks.length;
  for (const [bi, m] of blocks.entries()) {
    const start = m.index;
    const lead = text.slice(Math.max(floor, start - 1200), start);
    const endAt = Math.min(blocks[bi + 1]?.index ?? text.length, start + 9000);
    const rest = text.slice(start, endAt);
    const stop = rest.search(/In The Chair|The (House|Senate) agreed to the title|\n(?:Rep\.|Reps\.|Senator|Senators)\b/);
    const body = rest.slice(0, stop < 0 ? rest.length : stop);
    floor = start;
    if (!/by yeas and nays|as follows/i.test(lead.replace(/\s+/g, " ").slice(-300))) { drop("no-lead", `${d.name} ${JSON.stringify(lead.slice(-120))}`); continue; }
    if (/election of|roll of the House was called|confirm|nominat/i.test(lead.replace(/\s+/g, " ").slice(-300))) { drop("election-or-nomination-roll"); continue; }
    const header = headers.filter((h) => h.pos < start).at(-1);
    if (!header) { drop("no-bill", d.name); continue; }
    if (/^[HS]R /.test(header.bill)) { drop("simple-resolution"); continue; }
    // lists
    const parts = body.split(SECTION); // [pre, label, count, names, label, count, names, ...]
    const lists = { yes: [], no: [], absent: [], present: [] };
    const counts = {};
    let bad = false;
    for (let i = 1; i < parts.length; i += 3) {
      const slot = { Yeas: "yes", Nays: "no", Excused: "absent", "Not Voting": "absent", Present: "present" }[parts[i]];
      const names = parts[i + 2].split(/\t+|\n+/).map((t) => t.trim()).filter(Boolean).flatMap((chunk) => splitNames(chunk, chamber, d.date));
      const k = `${parts[i]}`;
      counts[k] = +parts[i + 1];
      if (names.length !== +parts[i + 1]) { drop(`tally-mismatch(${k})`, `${d.name} RC ${m[1]} ${k} ${names.length}/${parts[i + 1]}`); bad = true; break; }
      lists[slot].push(...names);
    }
    if (bad) continue;
    if (counts.Yeas === undefined || counts.Nays === undefined) { drop("no-yeas-nays-lists", d.name); continue; }
    const votes = {};
    for (const [slot, names] of Object.entries(lists)) {
      for (const raw of names) {
        const id = person(chamber, raw, d.date);
        if (id === "ambiguous") { bump(ambiguous, `${chamber}:${raw}`); bad = true; break; }
        if (!id) { bump(unmatched, `${chamber}:${raw}`); bad = true; break; }
        if (votes[id]) { drop("duplicate-member", `${d.name} ${raw}`); bad = true; break; }
        votes[id] = slot;
      }
      if (bad) break;
    }
    if (bad) { drop("unmatched-or-ambiguous-member"); continue; }
    if (chamber === "lower") for (const p of seatedOn("lower", d.date)) votes[p.id] ??= "absent"; // House prints only Yeas and Nays
    const rcKey = `${chamber}-${year}-${m[1]}`;
    if (seen.has(rcKey)) { drop("duplicate-roll-number", `${d.name} RC ${m[1]}`); continue; }
    seen.add(rcKey);
    const info = describe(lead);
    if (info.question === "Adopt resolution" && /^[HS]B /.test(header.bill)) { drop("resolution-without-header", d.name); continue; } // a simple/concurrent resolution with no "entitled" header: the latest bill header is stale
    const yes = lists.yes.length, no = lists.no.length;
    if (!info.failed && yes < no) { drop("outcome-conflict", `${d.name} ${header.bill} ${info.question} ${yes}-${no}`); continue; }
    if (info.failed && yes > no && !/[23]\/[34]|members serving/.test(lead.slice(-450))) { drop("outcome-conflict-failed", `${d.name} ${header.bill} ${yes}-${no} ${JSON.stringify(lead.replace(/\s+/g, " ").slice(-300))}`); continue; }
    // title: the paragraph after the bill header
    const t = /^\s*\n?(A[^\n]*)/.exec(text.slice(header.end));
    const title = t ? shortTitle(t[1].replace(/\t/g, " ").replace(/\s+/g, " ")) : header.bill;
    rolls[chamber].push({
      id: `mi-${chamber === "lower" ? "h" : "s"}-${d.date.replace(/-/g, "")}-${m[1]}`,
      bill: header.bill, title, date: d.date, chamber,
      question: info.question,
      kind: /^Uphold|^Adopt (amendment|substitute)/.test(info.question) ? "procedural" : classify({ motion_text: info.question, motion_classification: info.passage ? ["passage"] : [] }),
      outcome: `${info.failed ? "Failed" : "Passed"} ${yes}–${no}`,
      dateLabel: `${MONTHS[+d.date.slice(5, 7) - 1]} ${+d.date.slice(8, 10)}, ${year}`,
      sourceUrl: d.url,
      votes,
    });
  }
}
console.log(`found ${found.lower} House / ${found.upper} Senate roll-call blocks; kept ${rolls.lower.length} / ${rolls.upper.length}`);
console.log("dropped:", drops, "\nambiguous:", Object.fromEntries(ambiguous), "\nunmatched:", Object.fromEntries(unmatched));
// seat sanity: positions per roll call vs seated roster
for (const chamber of ["lower", "upper"]) {
  const off = rolls[chamber].filter((r) => Object.keys(r.votes).length !== seatedOn(chamber, r.date).length);
  console.log(`${chamber}: ${off.length} roll calls whose member count differs from seats on that date`, [...new Set(off.map((r) => `${r.date}:${Object.keys(r.votes).length}/${seatedOn(chamber, r.date).length}`))].slice(0, 15));
}
if (DRY) process.exit(0);

const now = new Date().toISOString();
for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id, "en", { numeric: true }));
  await writeSnapshot(join(OUT, `state-mi-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("mi", chamber),
    sourceLabel: `Roll call · Michigan ${chamber === "lower" ? "House" : "Senate"} floor votes (Michigan Legislature journals)`,
    keyBy: "openstates",
    jurisdiction: "mi",
    legislativeChamber: chamber,
    rollCalls: list.map(({ chamber: _c, ...r }) => r),
  }, { compact: true });
  const dates = list.map((r) => r.date).sort();
  console.log(`${chamber}: ${list.length} roll calls ${dates[0]}..${dates.at(-1)}`);
}
