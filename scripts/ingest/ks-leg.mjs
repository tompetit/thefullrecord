/**
 * Kansas 2025 and 2026 floor roll calls from the Legislature's own site (https://www.kslegislature.gov).
 * Replaces any sampled Open States files state-ks-{lower,upper}.json with every House and Senate roll call
 * listed in the site's public Votes explorer for the 2025-26 biennium.
 *
 * Pages (server-rendered HTML, plain GET):
 *   /b2025_26/votes/fragment/?page=N&per_page=20   list of roll calls (date, chamber, measure, action, tally, vote URL)
 *   /b2025_26/vote/?apn=...                         one roll call: date, action, short title, per-member Yea/Nay/Absent/
 *                                                   Not Voting/Present, each member linked to /legislators/{slug}/
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/ks.csv: the legislator slug
 * (rep_carpenter_will_1) is listed in each current member's Open States sources; former members are matched from
 * Open States' retired list by family + given name, then by chamber + surname when unique. Unmatched names are
 * dropped and reported. Appointment votes (no bill) and simple resolutions (HR/SR) are omitted. Absent, Not Voting
 * are stored as "absent". The site publishes no bill summary, so none is stored.
 *
 * Responses are cached in --work (default ~/.cache/ks-leg); <= 3 requests/second.
 * Run: node scripts/ingest/ks-leg.mjs [--work dir]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const SITE = "https://www.kslegislature.gov";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CHAMBER = { house: "lower", senate: "upper" };
const POSITION = { yea: "yes", nay: "no", present: "present", absent: "absent", "not-voting": "absent" };

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/ks-leg");
mkdirSync(work, { recursive: true });

/** Cached GET returning HTML text; a vote page is cached under a name derived from its URL. */
async function get(path, name) {
  const file = join(work, name);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const res = await politeGet(`${SITE}${path}`, { minGapMs: 350, retries: 6, headers: { Accept: "text/html" } });
  const text = await res.text();
  writeFileSync(file, text);
  return text;
}
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const text = (html) => decodeXml(html);
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

// --- Roster. slug key = legislator slug without rep_/sen_ prefix and trailing number (family_given).
const slugKey = (slug) => norm(slug.replace(/^(rep|sen)_/, "").replace(/_\d+$/, ""));
const people = csv(await (await politeGet("https://data.openstates.org/people/current/ks.csv")).text());
// Initials-only retired record (Open States lists sen_claeys_jr_1 in its sources): J.R. Claeys, served to Jul 2025; Joe Claeys (sen_claeys_joseph_1) replaced him.
const bySlug = new Map([["claeysjr", "ocd-person/2bbf4d79-672b-46f7-8745-ee91db3169e3"]]), cands = [];
for (const p of people) {
  for (const m of (p.sources ?? "").matchAll(/legislators\/((?:rep|sen)_[a-z0-9_]+?)\/?(?=[;,]|$)/g)) bySlug.set(slugKey(m[1]), p.id);
  cands.push({ id: p.id, family: norm(p.family_name), given: norm(p.given_name), chamber: p.current_chamber });
}
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/ks/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    if (!rest.length) continue; // initials-only filename (J-R-Claeys): cannot be matched safely
    cands.push({ id: `ocd-person/${m[2]}`, family: norm(rest.join("")), given: norm(given), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const unmatched = new Map(), viaFallback = new Map();
/** Open States id for a legislator link slug + display label; null (and counted) when unknown. */
function person(chamber, slug, label) {
  const key = slugKey(slug);
  if (bySlug.has(key)) return bySlug.get(key);
  // slug is family_given (the site sometimes reorders compound names); prefer a current member of this chamber,
  // then retired members, then a current member of the other chamber.
  const fam = norm(label.replace(/^[A-Z]\.\s+/, ""));
  const fits = (test) => cands.filter(test);
  const bySlugName = (c) => key === c.family + c.given || key === c.given + c.family || (key.startsWith(c.family) && key.length > c.family.length && (c.given.startsWith(key.slice(c.family.length)) || key.slice(c.family.length).startsWith(c.given)));
  const byLabel = (c) => c.family === fam || (fam.length > 3 && c.family.endsWith(fam));
  for (const test of [bySlugName, byLabel]) {
    for (const stage of [fits((c) => test(c) && c.chamber === chamber), fits((c) => test(c) && !c.chamber), fits((c) => test(c) && c.chamber && c.chamber !== chamber)]) {
      const ids = [...new Set(stage.map((c) => c.id))];
      if (ids.length === 1) { viaFallback.set(`${chamber}:${slug}`, ids[0]); return ids[0]; }
      if (ids.length > 1) break;
    }
  }
  return null;
}

// --- Roll-call list.
const list = [];
for (let page = 1; ; page++) {
  const html = await get(`/b2025_26/votes/fragment/?page=${page}&per_page=20&sort=date&dir=asc`, `list-${page}.html`);
  const total = Number(/of (\d+) votes/.exec(html)?.[1] ?? 0);
  for (const row of html.split("<tr data-href=").slice(1)) {
    const apn = /^"([^"]+)"/.exec(row)?.[1];
    const measure = /data-label="Measure"[\s\S]*?href="\/b2025_26\/(bills|resolutions)\/([^"/]+)\//.exec(row);
    list.push({ apn: decodeXml(apn).replace(/^.*apn=/, ""), kind: measure?.[1] ?? null, bill: measure?.[2] ?? null });
  }
  if (page * 20 >= total) { console.log(`${list.length} of ${total} roll calls listed`); break; }
}

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
let n = 0;
const seen = new Set();
for (const { apn, kind, bill } of list) {
  if (++n % 100 === 0) console.log(`${n}/${list.length}`);
  if (seen.has(apn)) { skip("duplicate"); continue; }
  seen.add(apn);
  if (!bill) { skip("no-bill (appointment)"); continue; }
  if (/^[HS]R\d/.test(bill)) { skip("simple-resolution"); continue; }
  const v = await get(`/b2025_26/vote/?apn=${apn}`, `vote-${apn.replace(/[^\w]/g, "_")}.html`);
  const chamber = CHAMBER[/\/(house|senate)\/legislative_days\//.exec(apn)?.[1]];
  const dm = /<span class="material-symbols-outlined"[^>]*>event<\/span>(\w+) (\d+), (\d{4})/.exec(v);
  const mi = dm ? MONTHS.indexOf(dm[1]) : -1;
  if (!chamber || mi < 0) { skip("bad-chamber-or-date"); continue; }
  const day = `${dm[3]}-${String(mi + 1).padStart(2, "0")}-${String(dm[2]).padStart(2, "0")}`;
  const motion = text(/<p class="list-hero-sub">([\s\S]*?)<\/p>/.exec(v)?.[1] ?? "");
  const title = text(/vote-hero-shorttitle">([\s\S]*?)<\/span>/.exec(v)?.[1] ?? "");
  const number = text(/gavel<\/span>\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(v)?.[1] ?? "") || bill;
  const tally = (k) => Number(new RegExp(`vote-tally-num--${k}">\\s*<span class="vote-tally-num-value">(\\d+)`).exec(v)?.[1] ?? NaN);
  const yea = tally("yea"), nay = tally("nay");
  const votes = {}; let yes = 0, no = 0, linked = 0;
  for (const sec of v.split('<section class="vote-paragraph-group">').slice(1)) {
    const pos = POSITION[/vote-paragraph-header--([\w-]+)/.exec(sec)?.[1]];
    if (!pos) { skip("unknown-position"); continue; }
    for (const m of sec.matchAll(/<a href="\/b2025_26\/legislators\/((?:rep|sen)_[a-z0-9_]+)\/">([^<]+)<\/a>/g)) {
      linked++;
      if (pos === "yes") yes++; else if (pos === "no") no++;
      const label = decodeXml(m[2]);
      const id = person(chamber, m[1], label);
      if (!id) { const k = `${chamber}:${m[1]} (${label})`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
      votes[id] = pos;
    }
  }
  if (yes !== yea || no !== nay) { skip("tally-mismatch"); continue; }
  if (!title || !Object.keys(votes).length) { skip("no-title-or-voters"); continue; }
  rolls[chamber].push({
    id: `ks-${chamber === "lower" ? "h" : "s"}-${/day\d+_(\d{8})\/vote_records\/(.+)\.odt$/.exec(apn)?.slice(1).join("-") ?? apn.replace(/\W+/g, "")}`,
    bill: number,
    title,
    question: motion || undefined,
    kind: classify({ motion_text: motion, motion_classification: /third reading|final action|passed|adopt|concur/i.test(motion) && !/amendment|table|reconsider/i.test(motion) ? ["passage"] : [] }),
    outcome: `${yea > nay ? "Passed" : "Failed"} ${yea}–${nay}`,
    date: day,
    dateLabel: `${MONTHS[mi].slice(0, 3)} ${Number(dm[2])}, ${dm[3]}`,
    sourceUrl: `${SITE}/b2025_26/vote/?apn=${apn}`,
    votes,
  });
}

for (const chamber of ["lower", "upper"]) {
  const rs = rolls[chamber];
  rs.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  await writeSnapshot(join(OUT, `state-ks-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("ks", chamber),
    sourceLabel: `Roll call · Kansas ${chamber === "lower" ? "House" : "Senate"} floor votes (Kansas Legislature)`,
    keyBy: "openstates",
    jurisdiction: "ks",
    legislativeChamber: chamber,
    rollCalls: rs,
  }, { compact: true });
  console.log(`${chamber}: ${rs.length} roll calls, ${rs[rs.length - 1]?.date}..${rs[0]?.date}`);
}
console.log("skipped:", skipped);
console.log("matched by name fallback (not slug):", Object.fromEntries(viaFallback));
console.log("unmatched members (votes dropped):", Object.fromEntries(unmatched));
