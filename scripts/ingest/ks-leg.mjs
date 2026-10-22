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
 * The vote page shows the bill's CURRENT short title, and its action text drops linked names ("Amendment by  was
 * rejected"). So each measure's page (/b2025_26/{bills|resolutions}/{slug}/: Versions with each version's short
 * title) and Legislative History (/history/, dated rows in order, each roll call linked by its apn) are read too:
 *   - title = short title of the newest version created before the roll call (version labels are tied to the
 *     history row that produced them: committee report "as amended" / substitute, Committee of the Whole "be passed
 *     as amended", amendment adopted before final action, and Enrolled from the adoption of the final conference
 *     report or concurrence). A failed conference report has no version of its own, so its vote keeps the bill's
 *     title as it then stood.
 *   - question = the history row's text for that roll call (full motion with names and result); outcome follows the
 *     result it states (veto overrides need two-thirds, so "Passed 82-42" can be a sustained veto).
 *   - Senate line-item-veto roll calls can name the wrong measure on the vote page (HB 2315 for HB 2513); they are
 *     assigned to the bill whose history records that line-item override (same day, chamber and veto items).
 *
 * Responses are cached in --work (default ~/.cache/ks-leg); <= 3 requests/second.
 * Run: node scripts/ingest/ks-leg.mjs [--work dir] [--retired-list file]
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
  // --retired-list FILE: one Open States retired filename per line (e.g. from `git ls-tree --name-only HEAD data/ks/retired/`
  // in a clone of openstates/people), for when the GitHub contents API is unreachable or rate-limited.
  const listing = args.includes("--retired-list")
    ? readFileSync(args[args.indexOf("--retired-list") + 1], "utf8").split("\n").map((l) => l.trim().replace(/^.*\//, "")).filter(Boolean).map((name) => ({ name }))
    : await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/ks/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
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

// --- Measure pages: version short titles and the dated, ordered legislative history.
const apnKey = (s) => { const t = decodeXml(s); try { return decodeURIComponent(t); } catch { return t; } };
const measurePath = (kind, slug) => `/b2025_26/${kind}/${slug}/`;
const versionsOf = (html) => [...html.matchAll(/<details class="version-row">[\s\S]*?class="label">([^<]*)<\/span>[\s\S]*?(?:version-shorttitle">([\s\S]*?)<\/p>|<\/details>)/g)]
  .map((m) => ({ label: decodeXml(m[1]), title: decodeXml(m[2] ?? "") })).reverse(); // oldest first
async function measure(kind, slug) {
  const page = await get(measurePath(kind, slug), `bill-${slug}.html`);
  const rows = [];
  for (let p = 1; ; p++) {
    const h = await get(`${measurePath(kind, slug)}history/?per_page=20&page=${p}`, `hist-${slug}-${p}.html`);
    for (const tr of h.split(/<tr class="history-row/).slice(1)) {
      const date = /data-label="Date">([^<]+)</.exec(tr)?.[1]?.trim();
      const chamber = CHAMBER[/history-chamber--(house|senate)/.exec(tr)?.[1]];
      const cell = /<td class="col-primary">([\s\S]*?)<\/td>/.exec(tr)?.[1] ?? "";
      const vote = /href="\/b2025_26\/vote\/\?apn=([^"]+)"/.exec(cell)?.[1];
      const msg = decodeXml(cell.replace(/<a href="\/b2025_26\/vote\/[\s\S]*?<\/a>/g, "")).replace(/\s+;/g, ";");
      const dm = /\w+, (\w{3}) (\d+), (\d{4})/.exec(date ?? "");
      const day = dm ? `${dm[3]}-${String(MONTHS.findIndex((x) => x.startsWith(dm[1])) + 1).padStart(2, "0")}-${dm[2].padStart(2, "0")}` : null;
      rows.push({ day, chamber, msg, vote: vote ? apnKey(vote) : null });
    }
    const m = /Showing \d+&ndash;(\d+) of (\d+) entries/.exec(h);
    if (!m || Number(m[1]) >= Number(m[2])) break;
  }
  rows.reverse(); // oldest first; rows on one day keep the site's order
  rows.forEach((r, i) => { r.i = i; });
  // Tie each version after the first to the history row that created it.
  const versions = versionsOf(page);
  let from = 0;
  // The enrolled text is the last conference report, adopted after the last failed conference round (rows within one
  // day are not reliably ordered, so "report now available" rows are not used as the boundary).
  const lastCcr = rows.findLastIndex((r) => /^Conference Committee Report (agree to disagree|not adopted)|not adopt Conference Committee Report passed|^Nonconcurred with amendments/i.test(r.msg));
  for (const v of versions.slice(1)) {
    const ch = /\bHouse\b|^H Sub/.test(v.label) ? "lower" : /\bSenate\b|^S Sub/.test(v.label) ? "upper" : null;
    const floor = /Committee of the Whole|on Final Action/i.test(v.label) || (/Amended by (House|Senate)\b/i.test(v.label) && !/Committee/i.test(v.label));
    const sub = /Sub\b/.test(v.label) || (/^\W*$/.test(v.label) && /^(House |Senate )?Substitute for/.test(v.title));
    // [test, fallback test]: the row that produced this version.
    const [test, fallback] = /^Enrolled/.test(v.label)
      ? [(r) => (lastCcr >= 0 ? r.i > lastCcr && /^(Conference Committee Report was adopted|Concurred with amendments)/i.test(r.msg) : /^Concurred with amendments/i.test(r.msg)), (r) => /^Enrolled and presented/i.test(r.msg)]
      : floor ? [(r) => /^Committee of the Whole - .*Be (passed|adopted) as (further )?amended|Final Action - .*as amended/i.test(r.msg), (r) => /Amendment by .* was adopted/i.test(r.msg)]
      : sub ? [(r) => /Committee Report recommending substitute (bill|resolution)/i.test(r.msg)]
      : /Committee/i.test(v.label) ? [(r) => /^Committee Report recommending (bill|resolution)\b.*\bas amended/i.test(r.msg)]
      : [];
    const find = (t) => t && rows.find((r) => r.i >= from && (!ch || r.chamber === ch || /^Enrolled/.test(v.label)) && t(r));
    const row = find(test) ?? find(fallback);
    if (!row) { v.at = null; versionMiss.push(`${slug}: ${v.label}`); continue; }
    // A version made by the roll call itself (final action as amended, conference report, concurrence) is what that roll call voted on.
    v.at = /^(Conference Committee Report was adopted|Concurred with amendments|(Emergency )?Final Action)/i.test(row.msg) ? row.i - 0.5 : row.i;
    from = row.i;
  }
  return { slug, versions, rows };
}
const versionMiss = [];
/** Short title of the newest version created before history position `pos` (or before/on `day` when unlinked). */
function titleAt(info, pos, day) {
  let title = info.versions[0]?.title ?? "";
  for (const v of info.versions.slice(1)) {
    if (v.at == null) continue;
    const r = info.rows[Math.ceil(v.at)];
    if (pos != null ? v.at < pos : r.day <= day) title = v.title || title;
  }
  return title;
}
const itemsOf = (s) => (s.match(/\b\d+(?:\([a-z]+\))?/gi) ?? []).map((t) => t.toLowerCase()).sort().join(" ");
const measures = new Map();
for (const { kind, bill } of list) if (bill && kind && !/^[HS]R\d/.test(bill) && !measures.has(bill)) measures.set(bill, await measure(kind, bill));

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
// Roll calls whose history text misstates the motion, corrected from the House Journal.
const JOURNAL_FIX = {
  // House Journal 2026-03-25: on Rep. Humphries' motion to adopt the CCR on HB 2422, Rep. Schmoe's substitute motion
  // "to not adopt the conference committee report and that a new conference committee be appointed" was the roll call
  // (Yeas 69, Nays 55); the history says only "Conference Committee Report not adopted".
  "0324_HB2422.odt": { question: "Substitute motion to not adopt Conference Committee Report and appoint a new conference committee passed; Rep. Susan Humphries, Rep. Laura Williams and Rep. Dan Osman appointed as second conferees", passed: true },
};
let n = 0, titled = 0;
const seen = new Set(), remapped = [], unlinked = [];
/**
 * Result as the official action text states it (the bill-history row, whose first clause says "passed", "failed",
 * "not adopted", "sustained", ...). Only when no result is stated (a Senate roll call missing from the history) is a
 * threshold applied: Kan. Const. art. 2 sec. 14(a),(b) -- a veto or line-item veto override needs two-thirds of the
 * members elected, 84 of 125 (House) or 27 of 40 (Senate); art. 14 sec. 1 -- a constitutional amendment (HCR/SCR) needs
 * two-thirds of all members elected, the same 84 / 27; otherwise a majority of those voting.
 */
function passed(question, yea, nay, chamber, bill) {
  const first = question.split(";")[0];
  if (/\b(failed|rejected|not adopted|not passed|lost)\b|veto\b.*\bsustained/i.test(first)) return false;
  if (/\b(prevailed|passed|adopted|overridden|concurred|carried|sustained)\b/i.test(first)) return true; // "Ruling of the chair was sustained"
  const twoThirds = chamber === "lower" ? 84 : 27;
  if (/veto/i.test(question)) return yea >= twoThirds;
  if (/^[HS]CR/.test(bill) && /final action|adopt/i.test(question) && !/amend|ccr|conference|concur/i.test(question)) return yea >= twoThirds;
  return yea > nay;
}
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
  let number = text(/gavel<\/span>\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(v)?.[1] ?? "") || bill;
  // History row for this roll call: linked by apn, else (line-item vetoes) same day, chamber and veto items.
  let info = measures.get(bill), row = info?.rows.find((r) => r.vote === apnKey(apn));
  if (!row && /line item veto/i.test(motion)) {
    const items = itemsOf(motion.replace(/line item veto override/i, ""));
    const hits = [...measures.values()].flatMap((m) => m.rows.filter((r) => r.day === day && r.chamber === chamber && /line item veto/i.test(r.msg) && itemsOf(r.msg.replace(/^.*?;\s*Line item veto/i, "")) === items).map((r) => [m, r]));
    if (hits.length === 1) {
      [[info, row]] = hits;
      const own = info.slug.replace(/^([A-Z]+)(\d+)$/, "$1 $2");
      if (own !== number) { remapped.push(`${apn}: ${number} -> ${own}`); number = own; }
    } else unlinked.push(apn);
  } else if (!row) unlinked.push(apn);
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
  const atVote = info ? titleAt(info, row?.i, day) : "";
  if (atVote && atVote !== title) titled++;
  const fix = JOURNAL_FIX[apn.replace(/^.*\//, "")];
  const question = fix?.question ?? (row?.msg.replace(/[;\s]+$/, "") || motion);
  rolls[chamber].push({
    id: `ks-${chamber === "lower" ? "h" : "s"}-${/day\d+_(\d{8})\/vote_records\/(.+)\.odt$/.exec(apn)?.slice(1).join("-") ?? apn.replace(/\W+/g, "")}`,
    bill: number,
    title: atVote || title,
    question: question || undefined,
    kind: classify({ motion_text: motion, motion_classification: /third reading|final action|passed|adopt|concur/i.test(motion) && !/amendment|table|reconsider/i.test(motion) ? ["passage"] : [] }),
    outcome: `${(fix?.passed ?? passed(question, yea, nay, chamber, number.replace(/\s+/g, ""))) ? "Passed" : "Failed"} ${yea}–${nay}`,
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
console.log(`titles set to the version at the vote (differs from the current title): ${titled}`);
console.log("versions not tied to a history row (ignored):", versionMiss);
console.log("roll calls re-assigned to another measure:", remapped);
console.log("roll calls with no history row (vote-page motion kept):", unlinked.length, unlinked.slice(0, 20));
console.log("matched by name fallback (not slug):", Object.fromEntries(viaFallback));
console.log("unmatched members (votes dropped):", Object.fromEntries(unmatched));
