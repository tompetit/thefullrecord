/**
 * Alaska 34th Legislature (2025-26) floor votes from the Legislature's own BASIS site (https://www.akleg.gov/basis).
 * Replaces any sampled Open States files state-ak-{lower,upper}.json with every House and Senate recorded floor roll
 * call (passage, amendments, concurrence, ...) that the bill pages list with a tally ("PASSED Y19 N1").
 *
 * Pages (server-rendered HTML, plain GET, no login):
 *   /basis/Bill/Range/34?bill1=HB1&bill2=HB999   bill list per prefix
 *   /basis/Bill/Detail/34?Root=HB   1            short title, full title, floor actions with a journal page link
 *   /basis/Journal/Pages/34?Chamber=H&Page=00500 the printed Journal page; a roll call is the "YEAS: n NAYS: n EXCUSED: n
 *                                                ABSENT: n" line followed by the Yeas/Nays/Excused/Absent surname lists
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/ak.csv by chamber + surname (the
 * journal prints surnames, with a first initial where two members of a chamber share one), then Open States' retired
 * list, then a current member of the other chamber (chamber switchers); a name that fits several people is dropped and
 * reported. The Senate/House presiding officer votes by name. Excused and Absent are stored as "absent".
 * A roll call is kept only when its stored yes/no counts equal the printed YEAS/NAYS line AND the action's tally.
 * BASIS publishes no bill summary, so no summary is stored.
 *
 * Responses are cached in --work (default ~/.cache/ak-leg); <= 3 requests/second.
 * Run: node scripts/ingest/ak-leg.mjs [--work dir]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, sleep, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const SITE = "https://www.akleg.gov";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHAMBER = { H: "lower", S: "upper" };

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/ak-leg");
mkdirSync(work, { recursive: true });

/** Cached GET (null on 404), ~1.4 requests/second (the site answers 429 above that), backs off on 429/5xx. */
let last = 0;
async function get(path, name) {
  const file = join(work, name);
  if (existsSync(file)) return readFileSync(file, "utf8");
  for (let attempt = 0; ; attempt++) {
    last = Math.max(last + 700, Date.now());
    const wait = last - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const res = await fetch(`${SITE}${path}`, { signal: AbortSignal.timeout(60_000), headers: { "User-Agent": "thefullrecord-ingest/1.0 (civic transparency)" } });
      if (res.status === 404) return null;
      if (res.status === 429) console.log(new Date().toISOString(), "429", path);
      if (!res.ok) throw new Error(`${path} -> ${res.status}`);
      const body = await res.text();
      writeFileSync(file, body);
      return body;
    } catch (e) {
      if (attempt >= 8) throw e;
      await sleep(15000 * (attempt + 1));
    }
  }
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

// --- Roster: Open States people (current, then retired) matched by surname (+ first initial).
const people = csv(await (await politeGet("https://data.openstates.org/people/current/ak.csv")).text());
const cands = []; // { id, given, names, chamber (current members only) }
for (const p of people) cands.push({ id: p.id, given: norm(p.given_name), names: new Set([norm(p.family_name), norm(p.family_name.split(" ").at(-1))]), chamber: p.current_chamber });
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/ak/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), names: new Set([norm(rest.join("")), norm(rest.at(-1) ?? "")]), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
// Robyn Burke (House 40) is Open States' Robyn Frier (name change).
const OVERRIDE = { "lower:burke": "ocd-person/c3b004d2-d62a-45de-a212-382396a20b59" };
const unmatched = new Map(); const ambiguous = new Map();
function person(chamber, label) {
  // "Nelson, D." / "D. Nelson" / "Nelson" -> surname + optional first initial
  let surname = label.trim(), initial;
  let m = /^(.*\S),\s*([A-Za-z])\.?$/.exec(surname);
  if (m) { surname = m[1]; initial = m[2].toLowerCase(); }
  else if ((m = /^([A-Za-z])\.\s*(.+)$/.exec(surname))) { surname = m[2]; initial = m[1].toLowerCase(); }
  const k = norm(surname);
  if (OVERRIDE[`${chamber}:${k}`]) return OVERRIDE[`${chamber}:${k}`];
  const fits = cands.filter((c) => c.names.has(k) && (!initial || c.given[0] === initial));
  for (const stage of [fits.filter((c) => c.chamber === chamber), fits.filter((c) => !c.chamber), fits.filter((c) => c.chamber && c.chamber !== chamber)]) {
    const ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { ambiguous.set(`${chamber}:${label}`, (ambiguous.get(`${chamber}:${label}`) ?? 0) + 1); return null; }
  }
  return null;
}

// --- Bills.
const billNames = [];
for (const prefix of ["HB", "SB", "HJR", "SJR", "HCR", "SCR", "HR", "SR"]) {
  const page = await get(`/basis/Bill/Range/34?bill1=${prefix}1&bill2=${prefix}999`, `range-${prefix}.html`);
  const roots = [...new Set([...page.matchAll(/Detail\/34\?Root=([^"']+)/g)].map((m) => decodeURIComponent(m[1].replace(/&amp;/g, "&"))))];
  billNames.push(...roots);
}
console.log(`${billNames.length} bills listed`);

// A floor action carrying a tally: "(S) PASSED Y19 N1", "(H) AM 1 FAILED Y15 N25 E0 A0".
const TALLY = /\bY(\d+)(?:\s+N(\d+))?(?:\s+E(\d+))?(?:\s+A(\d+))?\b/;

const decodeEntities = (t) => t.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

/** Journal page text, one string per page, with page markup removed. */
const pageCache = new Map();
async function journal(chamber, num) {
  const key = `${chamber}${String(num).padStart(5, "0")}`;
  if (!pageCache.has(key)) {
    const html = await get(`/basis/Journal/Pages/34?Chamber=${chamber}&Page=${String(num).padStart(5, "0")}`, `journal-${key}.html`);
    const pre = html && /<pre[\s\S]*?<\/pre>/i.exec(html)?.[0];
    pageCache.set(key, pre ? decodeEntities(pre.replace(/<[^>]+>/g, "")) : "");
  }
  return pageCache.get(key);
}

/** Roll-call blocks in journal text: header lines + counts + name lists. */
function blocks(txt) {
  const out = [];
  const lines = txt.split("\n").map((l) => l.replace(/\s+$/, ""));
  for (let i = 0; i < lines.length; i++) {
    const m = /^YEAS:\s+(\d+)\s+NAYS:\s+(\d+)\s+EXCUSED:\s+(\d+)\s+ABSENT:\s+(\d+)/.exec(lines[i]);
    if (!m) continue;
    const head = lines.slice(Math.max(0, i - 6), i).filter((l) => l.trim());
    const lists = { yeas: [], nays: [], excused: [], absent: [] };
    let cur = null, complete = false;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      const lm = /^(Yeas|Nays|Excused|Absent):\s*(.*)$/.exec(l);
      if (lm) { cur = lm[1].toLowerCase(); lists[cur].push(lm[2]); complete = false; continue; }
      if (!l.trim()) { if (cur) complete = true; cur = null; if (complete && j > i + 12) break; continue; }
      if (cur && !complete) lists[cur].push(l.trim());
      else if (/^and so,|^The question|^YEAS:/.test(l)) break;
    }
    const names = (a) => a.join(" ").split(",").map((s) => s.trim()).filter(Boolean);
    out.push({ tally: m.slice(1, 5).map(Number), head, yeas: names(lists.yeas), nays: names(lists.nays), excused: names(lists.excused), absent: names(lists.absent), end: lines.slice(i).length });
  }
  return out;
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
let n = 0, tallyMismatch = 0;
const seen = new Set(), used = new Set();
for (const root of billNames) {
  if (++n % 100 === 0) console.log(`${n}/${billNames.length} bills`);
  const page = await get(`/basis/Bill/Detail/34?Root=${encodeURIComponent(root)}`, `bill-${root.replace(/\s+/g, "_")}.html`);
  if (!page) { skip("bill-404"); continue; }
  const bill = root.replace(/\s+/g, " ").trim();
  const title = text(/<span>Short Title\s*<\/span>\s*<strong>([\s\S]*?)<\/strong>/.exec(page)?.[1] ?? "");
  const longTitle = text(/<span>Title\s*<\/span>\s*<strong>([\s\S]*?)<\/strong>/.exec(page)?.[1] ?? "").replace(/^"|"$/g, "");
  const actions = [...page.matchAll(/<tr class="floorAction"[\s\S]*?<\/tr>/g)].map((m) => {
    const tr = m[0];
    return {
      date: /datetime="([\d-]+)"/.exec(tr)?.[1],
      jp: /Journal\/Pages\/34\?Chamber=([HS])[^'"]*Page=(\d+)/.exec(tr),
      text: text(/data-label="Text"[^>]*>([\s\S]*?)<\/span>/.exec(tr)?.[1] ?? ""),
    };
  });
  for (const a of actions) {
    const chMark = /^\(([HS])\)/.exec(a.text)?.[1];
    const t = TALLY.exec(a.text);
    if (!t || !chMark || !a.jp || !a.date) continue;
    const chamber = CHAMBER[a.jp[1]];
    const ay = Number(t[1]), an = t[2] === undefined ? 0 : Number(t[2]);
    const num = Number(a.jp[2]);
    // The vote sits on the linked page or (amendments, long lists) a few pages later.
    let found;
    const amNo = /\bAM(?:ENDMENT)? NO\.? (\d+)/i.exec(a.text)?.[1];
    for (const span of [1, 2, 3, 4, 5, 6]) {
      let txt = "";
      for (let p = num; p < num + span; p++) txt += `\n${await journal(a.jp[1], p)}`;
      const digits = bill.replace(/^[A-Z]+\s*/, "");
      const cand = blocks(txt).filter((b) => b.tally[0] === ay && b.tally[1] === an && b.yeas.length === ay && b.nays.length === an && !used.has(`${a.jp[1]}${b.yeas.join()}${b.nays.join()}${b.head.join()}`) && (!amNo || new RegExp(`Amendment No\\.? ${amNo}\\b`, "i").test(b.head.join(" "))));
      const hdr = (b) => b.head.join(" ").replace(/\s+/g, "").toUpperCase();
      found = cand.find((b) => hdr(b).includes(root.replace(/\s+/g, "").toUpperCase())) ?? cand.find((b) => new RegExp(`\\b${digits}\\b`).test(b.head.join(" "))) ?? cand[0];
      if (found) break;
    }
    if (!found) { skip("no-journal-block-or-list-mismatch"); if (process.env.AK_DEBUG) console.log("MISS", root, a.date, a.jp[1], a.jp[2], a.text); continue; }
    used.add(`${a.jp[1]}${found.yeas.join()}${found.nays.join()}${found.head.join()}`);
    const id = `ak-${a.jp[1]}${a.jp[2]}-${bill.replace(/\s+/g, "")}-${a.date}-${ay}-${an}${amNo ? `-am${amNo}` : ""}`;
    if (seen.has(id)) { skip("duplicate"); continue; }
    seen.add(id);
    const votes = {}; let yes = 0, no = 0;
    for (const [list, pos] of [["yeas", "yes"], ["nays", "no"], ["excused", "absent"], ["absent", "absent"]]) {
      for (const name of found[list]) {
        if (pos === "yes") yes++; else if (pos === "no") no++;
        const pid = person(chamber, name);
        if (!pid) { const k = `${chamber}:${name}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
        votes[pid] = pos;
      }
    }
    if (yes !== found.tally[0] || no !== found.tally[1]) { tallyMismatch++; continue; }
    const headText = found.head.slice(-2).join(" - ").replace(/\s+/g, " ");
    const motion = a.text.replace(/^\([HS]\)\s*/, "");
    const proc = classify({ motion_text: `${motion} ${headText}`, motion_classification: /third reading|final passage|^passed|concur|adopt|override/i.test(`${motion} ${headText}`) ? ["passage"] : [] });
    rolls[chamber].push({
      id,
      bill,
      title: title || longTitle,
      question: motion,
      kind: proc,
      outcome: `${/FAIL|NOT /i.test(a.text) ? "Failed" : ay > an ? "Passed" : "Failed"} ${ay}–${an}`,
      date: a.date,
      dateLabel: `${MONTHS[Number(a.date.slice(5, 7)) - 1]} ${Number(a.date.slice(8, 10))}, ${a.date.slice(0, 4)}`,
      sourceUrl: `${SITE}/basis/Journal/Pages/34?Chamber=${a.jp[1]}&Bill=${encodeURIComponent(root)}&Page=${a.jp[2]}#${Number(a.jp[2])}`,
      votes,
    });
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-ak-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("ak", chamber),
    sourceLabel: `Roll call · Alaska ${chamber === "lower" ? "House" : "Senate"} floor votes (Alaska State Legislature)`,
    keyBy: "openstates",
    jurisdiction: "ak",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list[list.length - 1]?.date}..${list[0]?.date}`);
}
console.log("skipped:", skipped, "| tally mismatches:", tallyMismatch);
console.log("ambiguous surnames (votes dropped):", Object.fromEntries(ambiguous));
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
