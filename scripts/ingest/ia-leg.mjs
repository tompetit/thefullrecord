/**
 * Iowa 2025 and 2026 Regular Session floor votes (91st General Assembly), parsed from the Legislature's own daily journals.
 * Replaces any sampled Open States files state-ia-{lower,upper}.json with every recorded House and Senate floor roll call that
 * names its members and concerns a bill or resolution (passage, amendments, rules suspensions, concurrence). Non-record roll
 * calls ("The ayes were 63, nays 33." with no names), committee votes, appointment confirmations and anything whose tally
 * does not match the printed one are not imported.
 *
 * Sources (plain GETs of public files, <= 2.5 requests/s; robots.txt only disallows /chambers/):
 *   https://www.legis.iowa.gov/legislation/journals/{house|senate}?ga=91&session={1|2}  -> journal PDF links and dates
 *   https://www.legis.iowa.gov/docs/publications/{HJNL|SJNL}/YYYYMMDD_{HJNL|SJNL}.pdf   one text PDF per day
 * House journals print "The ayes were, N: <names> The nays were, N: <names> Absent or not voting, N: <names>", Senate
 * journals "Yeas, N: ... Nays, N: ... Absent, N: ...", names being surnames ("Johnson, C." where two members share one).
 * Names are matched to Open States people (current + retired role histories from github.com/openstates/people, cached) by
 * chamber, printed name and the journal date; each list must parse to exactly its printed count or the roll call is dropped.
 * Titles come from the bill's introduction line in the journals (the bill's official title). Iowa publishes no per-bill
 * summary in the journals, so none is stored.
 *
 * PDF text needs pypdf: pip install pypdf (see pdf-fulltext.py). Cache: --work (default ~/.cache/ia-leg).
 * Run: PYTHONPATH=... node scripts/ingest/ia-leg.mjs [--work dir] [--dry]
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/ia-leg");
for (const d of ["pdf", "txt", "people", "list"]) mkdirSync(join(work, d), { recursive: true });
const gap = { minGapMs: 400 };
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

// ---------------------------------------------------------------- journal list and PDFs
const days = []; // { chamber, date, url, pdf, txt }
for (const [chamber, path, code] of [["lower", "house", "HJNL"], ["upper", "senate", "SJNL"]]) {
  for (const session of [1, 2]) {
    const listing = join(work, "list", `${path}-${session}.html`);
    if (!existsSync(listing)) writeFileSync(listing, await (await politeGet(`https://www.legis.iowa.gov/legislation/journals/${path}?ga=91&session=${session}`, gap)).text());
    const html = readFileSync(listing, "utf8");
    for (const m of html.matchAll(/<a href="(\/docs\/publications\/[HS]JNL\/[^"]+\.pdf)"[^>]*>([^<]*)<\/a>/g)) {
      const label = /Journal (\d\d)\/(\d\d)\/(\d{4})/.exec(m[2]);
      if (!label) continue; // "Journal Supplement" (index) pages carry no floor votes
      const date = `${label[3]}-${label[1]}-${label[2]}`;
      const name = m[1].split("/").at(-1).replace(/\.pdf$/, "");
      days.push({ chamber, date, url: `https://www.legis.iowa.gov${m[1]}`, pdf: join(work, "pdf", `${code}_${name}.pdf`), txt: join(work, "txt", `${code}_${name}.txt`) });
    }
  }
}
for (const d of days) {
  if (existsSync(d.pdf)) continue;
  const res = await politeGet(d.url, { ...gap, allow404: true });
  if (res) writeFileSync(d.pdf, Buffer.from(await res.arrayBuffer()));
}
const pending = days.filter((d) => existsSync(d.pdf) && !existsSync(d.txt));
for (let i = 0; i < pending.length; i += 25) {
  const chunk = pending.slice(i, i + 25);
  await new Promise((resolve, reject) => execFile("python3", [join(dirname(fileURLToPath(import.meta.url)), "pdf-fulltext.py"), ...chunk.flatMap((d) => [d.pdf, d.txt])],
    {}, (e, _o, err) => (e ? reject(e) : (err && console.warn(err), resolve()))));
}
const have = days.filter((d) => existsSync(d.txt));
console.log(`${have.filter((d) => d.chamber === "lower").length} House journals, ${have.filter((d) => d.chamber === "upper").length} Senate journals (of ${days.length} listed)`);

// ---------------------------------------------------------------- roster (Open States people, role histories)
async function peopleFiles(dir) {
  const cache = join(work, "people", `${dir}.json`);
  if (!existsSync(cache)) {
    const list = await (await politeGet(`https://api.github.com/repos/openstates/people/contents/data/ia/${dir}`, { ...gap, headers: { Accept: "application/vnd.github+json" } })).json();
    writeFileSync(cache, JSON.stringify(list.map((x) => ({ name: x.name, url: x.download_url }))));
  }
  return JSON.parse(readFileSync(cache, "utf8"));
}
const unq = (s) => s.replace(/^['"]|['"]$/g, "");
/** { id, keys:Set(printed spellings, letters only), roles } for every current and retired Iowa legislator with a 2025+ role. */
const roster = [];
for (const dir of ["legislature", "retired"]) {
  for (const f of await peopleFiles(dir)) {
    const file = join(work, "people", f.name);
    if (!existsSync(file)) writeFileSync(file, await (await politeGet(f.url, { minGapMs: 250 })).text());
    const y = readFileSync(file, "utf8").split(/\n(?=other_identifiers:|links:|sources:|offices:)/)[0];
    const id = /^id: (\S+)/m.exec(y)?.[1];
    const family = unq(/^family_name: (.+)$/m.exec(y)?.[1] ?? "");
    const given = unq(/^given_name: (.+)$/m.exec(y)?.[1] ?? "");
    const rolesText = /^roles:\n([\s\S]*?)(?=^(?!- |  )\S)/m.exec(`${y}\nend:`)?.[1] ?? "";
    const roles = rolesText.split(/^- /m).filter(Boolean).map((r) => ({
      type: /type: (\w+)/.exec(r)?.[1], district: /district: '?([^'\n]+)'?/.exec(r)?.[1],
      start: /start_date: '?([\d-]+)/.exec(r)?.[1] ?? "0000", end: /end_date: '?([\d-]+)/.exec(r)?.[1] ?? "9999",
    })).filter((r) => (r.type === "lower" || r.type === "upper") && r.end >= "2024-12-01");
    if (!id || !roles.length) continue;
    const bare = family.replace(/\s+(jr|sr|ii|iii)\.?$/i, "");
    const others = [...(/^other_names:\n((?:- .*\n|  .*\n)+)/m.exec(readFileSync(file, "utf8"))?.[1] ?? "").matchAll(/^- name: (.+)$/gm)].map((x) => norm(unq(x[1])));
    const keys = new Set([norm(family), norm(bare), norm(bare) + norm(given)[0], norm(family.split(/\s+/).at(-1)), ...others]);
    roster.push({ id, keys, current: dir === "legislature", roles });
  }
}
console.log(`${roster.length} legislators with a 2025+ role`);

const unmatched = new Map(), ambiguous = new Map();
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
/** Open States id for a printed name key, or null / "ambiguous". */
const personCache = new Map();
function person(chamber, key, date) {
  const ck = `${chamber}|${key}|${date}`;
  if (personCache.has(ck)) return personCache.get(ck);
  const fits = (loose) => roster.filter((p) => p.keys.has(key) && p.roles.some((r) => r.type === chamber && (loose || (r.start <= date && date <= r.end))));
  let c = fits(false);
  if (!c.length) c = fits(true);
  if (c.length > 1 && c.filter((p) => p.current).length === 1) c = c.filter((p) => p.current);
  const out = c.length === 1 ? c[0].id : c.length ? "ambiguous" : null;
  personCache.set(ck, out);
  return out;
}
/** Every key ever used as a printed name in a chamber (for segmenting "Kniff McCulla Konfrst" into names). */
const keySet = (chamber) => { const s = new Set(); for (const p of roster) if (p.roles.some((r) => r.type === chamber)) for (const k of p.keys) s.add(k); return s; };
const KEYS = { lower: keySet("lower"), upper: keySet("upper") };

/** Split a printed list into name keys: longest run of words that is a known name wins; null when a word fits nothing. */
function segment(chamber, block) {
  const words = block.replace(/,?\s*\b(?:Presiding|Spkr\.?|Speaker)\b/g, "").replace(/\s+-\s*/g, "-").split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length;) {
    let hit = 0;
    if (words[i] === "Open" && !KEYS[chamber].has("open")) { out.push({ vacant: true }); i++; continue; } // a vacant seat is counted in the printed tally
    for (let n = Math.min(4, words.length - i); n >= 1; n--) {
      if (KEYS[chamber].has(norm(words.slice(i, i + n).join(" ")))) { hit = n; break; }
    }
    if (!hit) return { bad: words[i] };
    out.push({ key: norm(words.slice(i, i + hit).join(" ")), raw: words.slice(i, i + hit).join(" ") });
    i += hit;
  }
  return { names: out };
}

// ---------------------------------------------------------------- journal text
/** Page text with running headers and the page markers removed; starts[] = offset where each PDF page begins. */
function load(d) {
  const raw = readFileSync(d.txt, "utf8").split("\f@@PAGE ").slice(1);
  let text = ""; const starts = [];
  for (const page of raw) {
    starts.push(text.length);
    const lines = page.replace(/^\d+\n/, "").split("\n").filter((l) => !/^\s*\d+\s+JOURNAL OF THE (HOUSE|SENATE)\s+\d+\w+ Day\s*$/i.test(l) && !/^\s*\d+\w+ Day\s+\w+DAY, \w+ \d+, \d{4}\s+\d+\s*$/i.test(l) && !/^\s*\d+\w+ Day\s+\w+DAY, \w+ \d+, \d{4}\s*$/i.test(l));
    text += `${lines.join("\n")}\n`;
  }
  return { text, starts };
}
const pageOf = (starts, pos) => starts.findIndex((s, i) => s <= pos && (i + 1 >= starts.length || starts[i + 1] > pos)) + 1;

const NAMES_LINE = /^[ \t]*[A-Z][\w'’.-]*(?:,?[ \t]+[A-Z][\w'’.-]*)*,?[ \t]*$/; // a line of capitalised words only
const SECTION = /^[ \t]*(Yeas|Nays|Absent or not voting|Absent|Excused|Present|Not voting|The ayes were|The nays were)[ \t]*,[ \t]*(\d+|none)[ \t]*[:.][ \t]*$/i;
/** Reads the labelled name lists that follow a vote lead-in. Returns { yes, no, absent, other, end } with { count, block } each. */
function readSections(text, from) {
  const lines = text.slice(from).split("\n");
  const out = {}; let pos = from, cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = SECTION.exec(line);
    if (m) {
      const label = m[1].toLowerCase();
      const slot = /ayes|yeas/.test(label) ? "yes" : /nays/.test(label) ? "no" : /present/.test(label) ? "present" : "absent";
      if (out[slot]) { out.dup = true; }
      cur = out[slot] = out[slot] ?? { count: 0, block: "" };
      cur.count += m[2].toLowerCase() === "none" ? 0 : +m[2];
      pos += line.length + 1;
      continue;
    }
    if (!cur) { if (line.trim() === "") { pos += line.length + 1; continue; } break; }
    if (line.trim() === "") { // a blank line ends a list only once it has names (or says none)
      const next = lines.slice(i + 1).find((l) => l.trim() !== "");
      if (next !== undefined && SECTION.test(next)) { pos += line.length + 1; cur = null; continue; }
      pos += line.length + 1;
      if (next !== undefined && cur.count > 0 && NAMES_LINE.test(next)) continue; // list resumes after a page break
      if (cur.block.trim() || cur.count === 0) break;
      continue;
    }
    cur.block += ` ${line.trim()}`;
    pos += line.length + 1;
  }
  out.end = pos;
  return out;
}

const BILL_ABBR = (s) => s.replace(/[.\s]/g, "").replace(/^([HS][FJC]?[FRC]?)(\d+)$/, "$1 $2");
const rolls = { lower: [], upper: [] };
const drops = {}; const drop = (why) => { drops[why] = (drops[why] ?? 0) + 1; };
const found = { lower: 0, upper: 0 };
const titleSrc = [];

for (const d of have) {
  const { text, starts } = load(d);
  const chamber = d.chamber;
  const start = chamber === "lower" ? /^[ \t]*The ayes were,[ \t]*(\d+|none)[ \t]*:/gm : /^[ \t]*Yeas,[ \t]*(\d+|none)[ \t]*:/gm;
  titleSrc.push(text);
  let seq = 0;
  for (const m of text.matchAll(start)) {
    found[chamber]++;
    const lead = text.slice(Math.max(0, m.index - 700), m.index).replace(/\s+/g, " ");
    const q = [...lead.matchAll(/On the question\s*“([^”(]*?)\s*(?:”|(?=\())\s*,?\s*(?:\(([^)]*)\)|([HS]\.[A-Z.]*\s*\d+))?/g)].at(-1);
    if (!q) { drop("no-question"); if (dry) console.log("NOQ", d.date, chamber, JSON.stringify(lead.slice(-200))); continue; }
    const question = q[1].replace(/\s+/g, " ").trim();
    if (/appointee|appointment/i.test(question)) { drop("appointment"); continue; }
    const billRaw = q[2] ?? q[3] ?? "";
    const bm = /^([HS])\.?\s*([FJC])?\.?\s*([FRC])?\.?\s*(\d+)$/.exec(billRaw.trim());
    if (!bm) { drop("no-bill"); if (dry) console.log("NOBILL", d.date, chamber, JSON.stringify(question), JSON.stringify(billRaw)); continue; }
    const bill = `${bm[1]}${bm[2] ?? ""}${bm[3] ?? ""} ${bm[4]}`;
    if (!/^[HS](F|JR|CR) /.test(bill)) { drop("simple-resolution-or-other"); continue; }
    const s = readSections(text, m.index);
    const counts = { yes: s.yes?.count ?? 0, no: s.no?.count ?? 0, present: s.present?.count ?? 0, absent: s.absent?.count ?? 0 };
    if (!s.yes || !s.no || s.dup) { drop("odd-sections"); if (dry) console.log("ODD", d.date, chamber, bill, Object.keys(s)); continue; }
    const votes = {}; let bad = false;
    for (const slot of ["yes", "no", "present", "absent"]) {
      const block = (s[slot]?.block ?? "").trim();
      const seg = segment(chamber, block);
      if (seg.bad || seg.names.length !== counts[slot]) { drop(`tally-mismatch(${slot})`); if (dry) console.log("MISMATCH", d.date, chamber, bill, slot, seg.bad ?? seg.names.length, counts[slot]); bad = true; break; }
      for (const n of seg.names) {
        if (n.vacant) continue;
        const id = person(chamber, n.key, d.date);
        if (id === "ambiguous") { bump(ambiguous, `${chamber}:${n.raw}`); bad = true; break; }
        if (!id) { bump(unmatched, `${chamber}:${n.raw}`); bad = true; break; }
        if (votes[id]) { drop("duplicate-member"); bad = true; break; }
        votes[id] = slot;
      }
      if (bad) break;
    }
    if (bad) { drop("unmatched-or-ambiguous-member"); continue; }
    const after = text.slice(s.end, s.end + 420).replace(/\s+/g, " ");
    const failed = /\b(lost|failed|did not (?:receive|prevail)|not adopted|defeated|not prevail|not been adopted)\b/i.test(after.split(/(?<=\.) /).slice(0, 2).join(" "));
    if (!failed && counts.yes < counts.no) { drop("outcome-conflict"); if (dry) console.log("CONFLICT", d.date, bill, counts, after.slice(0, 120)); continue; }
    const procedural = /rules be suspended|withdrawn from committee|placed on the calendar|reconsider|table/i.test(question);
    rolls[chamber].push({
      id: `ia-${chamber === "lower" ? "h" : "s"}-${d.date.replace(/-/g, "")}-${String(++seq).padStart(2, "0")}`,
      bill, date: d.date, question,
      kind: procedural ? "procedural" : classify({ motion_text: question, motion_classification: /^Shall the bill pass/.test(question) || /^Shall the resolution be adopted/.test(question) ? ["passage"] : [] }),
      outcome: `${failed ? "Failed" : "Passed"} ${counts.yes}–${counts.no}`,
      dateLabel: `${MONTHS[+d.date.slice(5, 7) - 1]} ${+d.date.slice(8, 10)}, ${d.date.slice(0, 4)}`,
      sourceUrl: `${d.url}#page=${pageOf(starts, m.index)}`,
      votes,
    });
  }
}
console.log(`found ${found.lower}/${found.upper} vote blocks; kept ${rolls.lower.length} House, ${rolls.upper.length} Senate before titles`);
if (dry) console.log("dropped:", drops, "\nambiguous:", Object.fromEntries(ambiguous), "\nunmatched:", Object.fromEntries(unmatched));

// ---------------------------------------------------------------- titles (the introduction line: "House File 5 , by <sponsors>, a bill for an act <title>.")
const titles = new Map();
const TITLE = /\b(House|Senate)\s+(File|Joint Resolution|Concurrent Resolution)\s+(\d+)\s*,?\s*(?:by [^]{0,600}?,\s*)?(?:a|an)\s+(?:bill\s+for\s+an\s+act|joint\s+resolution|concurrent\s+resolution)\s+([^.]{8,2500}?)(?:,\s*(?:was taken up|with report|as amended|and was)\b[^.]*)?\./g;
for (const t of titleSrc) {
  const flat = t.replace(/\s+/g, " ");
  for (const m of flat.matchAll(TITLE)) {
    const ab = m[2] === "File" ? "F" : m[2] === "Joint Resolution" ? "JR" : "CR";
    const key = `${m[1][0]}${ab} ${m[3]}`;
    if (!titles.has(key)) titles.set(key, m[4].replace(/\s+/g, " ").replace(/ -(?=\w)/g, "-").trim());
  }
}
const noTitle = new Set();
for (const chamber of ["lower", "upper"]) {
  for (const r of rolls[chamber]) {
    const t = titles.get(r.bill)?.replace(/,?\s*(?:amended|passed) by\s+the\s+(?:Senate|House)\b.*$/i, "");
    r.title = t ? (t.length > 500 ? `${t.slice(0, 497).trimEnd()}...` : t).replace(/^./, (c) => c.toUpperCase()) : (noTitle.add(r.bill), r.bill);
  }
}
if (dry) { console.log("bills without a title:", [...noTitle].length, [...noTitle].slice(0, 20)); process.exit(0); }

const now = new Date().toISOString();
for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  await writeSnapshot(join(OUT, `state-ia-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("ia", chamber),
    sourceLabel: `Roll call · Iowa ${chamber === "lower" ? "House" : "Senate"} floor votes (Iowa Legislature journals)`,
    keyBy: "openstates",
    jurisdiction: "ia",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  const dates = list.map((r) => r.date).sort();
  console.log(`${chamber}: ${list.length} roll calls ${dates[0]}..${dates.at(-1)}`);
}
console.log("dropped:", drops);
console.log("bills without a title:", [...noTitle]);
console.log("ambiguous names:", Object.fromEntries(ambiguous));
console.log("unmatched names:", Object.fromEntries(unmatched));
