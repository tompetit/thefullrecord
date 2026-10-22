/**
 * Kentucky 2025 and 2026 Regular Session floor votes from the General Assembly's own bill pages.
 * Replaces the sampled Open States files state-ky-{lower,upper}.json with every House and Senate floor roll call on a
 * bill or joint/concurrent resolution (passage, final passage, veto overrides, concurrence, amendments, committee
 * substitutes and procedural motions that were taken by roll call). Simple resolutions (HR/SR) are not imported.
 *
 * Sources (plain GETs of public files):
 *   https://apps.legislature.ky.gov/record/{25rs|26rs}/{house_bills|senate_bills|house_resolutions|senate_resolutions}.html   bill index
 *   https://apps.legislature.ky.gov/record/{25rs|26rs}/{bill}/vote_history.pdf   "Vote History": one text PDF per bill with
 *       every floor roll call of both chambers (404 when the bill never had one)
 *   https://apps.legislature.ky.gov/record/{25rs|26rs}/{bill}.html   bill page: official title ("AN ACT relating to ...")
 * Each vote prints YEAS / NAYS / ABSTAINED (House) or PASSES (Senate) / NOT VOTING counts and the surnames in columns
 * (shared surnames carry a first initial, "Lewis D"; multi-word surnames print in full). Names are matched to Open States
 * people (current + retired role histories from github.com/openstates/people, cached) by chamber, surname (+ initial) and the
 * vote date. Each stored tally must equal the printed count of every list, otherwise the roll call is dropped and counted.
 * A name that fits no one or several people drops the roll call (no partial voter lists).
 * Kentucky publishes no summary beyond the bill title, so no `summary` is set.
 *
 * PDF text needs pypdf (see pdf-fulltext.py). Cache: --work (default ~/.cache/ky-leg).
 * Run: PYTHONPATH=... node scripts/ingest/ky-leg.mjs [--work dir] [--dry]
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BASE = "https://apps.legislature.ky.gov/record";
const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/ky-leg");
for (const d of ["pdf", "txt", "people", "page", "index"]) mkdirSync(join(work, d), { recursive: true });
const gap = { minGapMs: 400 };
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const SESSIONS = ["25rs", "26rs"];

// ---------------------------------------------------------------- bill index and vote PDFs
async function cachedText(url, file) {
  if (existsSync(file)) return readFileSync(file, "utf8");
  const body = await (await politeGet(url, gap)).text();
  writeFileSync(file, body);
  return body;
}
const bills = []; // { session, id (hb12), file }
for (const session of SESSIONS) {
  const ids = new Set();
  for (const idx of ["house_bills", "senate_bills", "house_resolutions", "senate_resolutions"]) {
    const html = await cachedText(`${BASE}/${session}/${idx}.html`, join(work, "index", `${session}-${idx}.html`));
    for (const m of html.matchAll(/href="((?:hb|sb|hjr|sjr|hcr|scr)\d+)\.html"/g)) ids.add(m[1]);
  }
  for (const id of ids) bills.push({ session, id, file: join(work, "pdf", `${session}-${id}.pdf`), txt: join(work, "txt", `${session}-${id}.txt`) });
}
console.log(`${bills.length} bills and joint/concurrent resolutions listed`);

for (const b of bills) {
  if (existsSync(b.file) || existsSync(`${b.file}.none`)) continue;
  const res = await politeGet(`${BASE}/${b.session}/${b.id}/vote_history.pdf`, { ...gap, allow404: true });
  const buf = res ? Buffer.from(await res.arrayBuffer()) : null;
  if (buf?.subarray(0, 4).toString() === "%PDF") writeFileSync(b.file, buf);
  else writeFileSync(`${b.file}.none`, "");
}
const withVotes = bills.filter((b) => existsSync(b.file));
console.log(`${withVotes.length} bills have a vote history`);

const pending = withVotes.filter((b) => !existsSync(b.txt));
for (let i = 0; i < pending.length; i += 25) {
  const chunk = pending.slice(i, i + 25);
  await new Promise((resolve, reject) => execFile("python3", [join(dirname(fileURLToPath(import.meta.url)), "pdf-fulltext.py"), ...chunk.flatMap((b) => [b.file, b.txt])],
    {}, (e, _o, err) => (e ? reject(e) : (err && console.warn(err), resolve()))));
}

// ---------------------------------------------------------------- roster (Open States people, role histories)
async function peopleFiles(dir) {
  const cache = join(work, "people", `${dir}.json`);
  if (!existsSync(cache)) {
    const list = await (await politeGet(`https://api.github.com/repos/openstates/people/contents/data/ky/${dir}`, { ...gap, headers: { Accept: "application/vnd.github+json" } })).json();
    writeFileSync(cache, JSON.stringify(list.map((x) => ({ name: x.name, url: x.download_url }))));
  }
  return JSON.parse(readFileSync(cache, "utf8"));
}
const roster = []; // { id, current, family, initial, roles }
for (const dir of ["legislature", "retired"]) {
  for (const f of await peopleFiles(dir)) {
    const file = join(work, "people", f.name);
    if (!existsSync(file)) writeFileSync(file, await (await politeGet(f.url, { minGapMs: 250 })).text());
    const y = readFileSync(file, "utf8").split(/\n(?=other_identifiers:|links:|sources:|offices:)/)[0];
    const id = /^id: (\S+)/m.exec(y)?.[1];
    const unq = (s) => s?.replace(/^['"]|['"]$/g, "") ?? "";
    const family = unq(/^family_name: (.+)$/m.exec(y)?.[1]);
    const given = unq(/^given_name: (.+)$/m.exec(y)?.[1]);
    const rolesText = /^roles:\n([\s\S]*?)(?=^(?!- |  )\S)/m.exec(`${y}\nend:`)?.[1] ?? "";
    const fixEnd = /Johnnie-Turner/.test(f.name); // Open States closed his Senate term in 2024; he still votes in 2025-26
    const roles = rolesText.split(/^- /m).filter(Boolean).map((r) => ({
      type: /type: (\w+)/.exec(r)?.[1],
      start: /start_date: '?([\d-]+)/.exec(r)?.[1] ?? "0000", end: fixEnd ? "9999" : /end_date: '?([\d-]+)/.exec(r)?.[1] ?? "9999",
    })).filter((r) => (r.type === "lower" || r.type === "upper") && r.end >= "2024-12-01");
    if (!id || !family || !roles.length) continue;
    // Open States drops compound surnames ("Tackett Laferty" is stored as "Laferty"); the file name keeps every part.
    const parts = f.name.replace(/\.yml$/, "").split("-").slice(0, -5);
    const families = new Set([norm(family)]);
    for (let k = 1; k < parts.length; k++) families.add(norm(parts.slice(-k).join("")));
    if (/^Deanna-Frazier-/.test(f.name)) families.add("fraziergordon"); // Open States: "Deanna Gordon"; the House prints "Frazier Gordon"
    families.delete("");
    roster.push({ id, current: dir === "legislature", families, initial: norm(given)[0] ?? "", roles });
  }
}
console.log(`${roster.length} legislators with a 2025+ role`);

// Initials printed beside shared surnames ("Lewis D"): the bare surname then means the member without a printed initial.
const printedInitials = new Map(); // "session:family" -> Set(initial); the House added initials for every Lewis only in 2026
const allText = new Map();
for (const b of withVotes) {
  const t = readFileSync(b.txt, "utf8");
  allText.set(b.txt, t);
  for (const m of t.matchAll(/\b([A-Z][A-Za-z'-]+) ([A-Z])\.?(?=\s|$)/gm)) {
    const fam = norm(m[1]);
    if (roster.some((p) => p.families.has(fam))) (printedInitials.get(`${b.session}:${fam}`) ?? printedInitials.set(`${b.session}:${fam}`, new Set()).get(`${b.session}:${fam}`)).add(m[2].toLowerCase());
  }
}

/** Roster candidates for a printed token sequence in a chamber on a date. */
function candidates(chamber, key, date, session) {
  const fits = (loose) => roster.filter((p) => p.roles.some((r) => r.type === chamber && (loose || (r.start <= date && date <= r.end))));
  for (const loose of [false, true]) {
    const pool = fits(loose);
    const printed = (p, fam) => printedInitials.get(`${session.session}:${fam}`)?.has(p.initial);
    const here = (p) => [...p.families].some((fam) => session.here.has(fam + p.initial)); // "Lewis D" printed in this very vote
    let c = pool.filter((p) => [...p.families].some((fam) => key === fam + p.initial && printed(p, fam)));
    if (!c.length) {
      c = pool.filter((p) => p.families.has(key));
      if (c.length > 1) { // bare shared surname: the member whose initial is never printed
        for (const unprinted of [c.filter((p) => !here(p)), c.filter((p) => !printed(p, key))]) if (unprinted.length === 1) { c = unprinted; break; }
      }
    }
    if (c.length > 1 && c.filter((p) => p.current).length === 1) c = c.filter((p) => p.current); // duplicate Open States records
    if (c.length) return [...new Set(c.map((p) => p.id))];
  }
  return [];
}

const unmatched = new Map(), ambiguous = new Map();
/** Split a column-printed name block into exactly `count` distinct people, or null. Tokens join into 1-3 word surnames. */
function parseNames(chamber, block, count, date, session) { // session: { session, here: Set of surname+initial printed in this vote }
  const tokens = block.replace(/([a-z])(?=[A-Z])/g, "$1 ").split(/\s+/).filter(Boolean); // the PDF text sometimes glues neighbouring columns ("WilsonStiversMcDaniel")
  let reach = 0;
  const walk = (i, used) => {
    reach = Math.max(reach, i);
    if (i === tokens.length) return used.size === count ? [] : null;
    for (let len = Math.min(4, tokens.length - i); len >= 1; len--) {
      const raw = tokens.slice(i, i + len).join(" ");
      const c = candidates(chamber, norm(raw), date, session);
      if (c.length !== 1 || used.has(c[0])) continue;
      used.add(c[0]);
      const rest = walk(i + len, used);
      used.delete(c[0]);
      if (rest) return [c[0], ...rest];
    }
    return null;
  };
  const ids = walk(0, new Set());
  if (ids) return ids;
  // diagnose
  if (process.env.KY_DEBUG) console.log("STUCK at", tokens.slice(Math.max(0, reach - 2), reach + 3).join(" "), reach, tokens.length, count);
  const covered = new Set();
  for (let i = 0; i < tokens.length; i++) for (let len = 1; len <= 4 && i + len <= tokens.length; len++) {
    if (candidates(chamber, norm(tokens.slice(i, i + len).join(" ")), date, session).length === 1) for (let j = i; j < i + len; j++) covered.add(j);
  }
  tokens.forEach((t, i) => { if (!covered.has(i)) { const k = `${chamber}:${t}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); } });
  return null;
}

// ---------------------------------------------------------------- parse vote blocks
const rolls = { lower: [], upper: [] };
const drops = {}; const drop = (why) => { drops[why] = (drops[why] ?? 0) + 1; };
const AMEND = { HFA: "House Floor Amendment", SFA: "Senate Floor Amendment", HCS: "House Committee Substitute", SCS: "Senate Committee Substitute", HFTA: "House Floor Title Amendment", SFTA: "Senate Floor Title Amendment", HCTA: "House Committee Title Amendment", SCTA: "Senate Committee Title Amendment", HCA: "House Committee Amendment", SCA: "Senate Committee Amendment", CCR: "Conference Committee Report", FCCR: "Free Conference Committee Report" };
const expand = (s) => s.replace(/\b([HS]?[A-Z]{2,4}) ?(\d+)\b/g, (m, a, n) => (AMEND[a] ? `${AMEND[a]} ${n}` : m));
const NAME_HEAD = /^(YEAS|NAYS|ABSTAINED|PASSES|NOT VOTING) : (\d+)[ \t]*$/gm;
const seen = new Set();
const found = { lower: 0, upper: 0 };

for (const b of withVotes) {
  const raw = allText.get(b.txt).replace(/\f?@@PAGE (\d+)\n?/g, "\n@@P$1@@\n");
  const parts = raw.split(/^(?=Commonwealth of Kentucky *\n *House of Representatives|COMMONWEALTH OF KENTUCKY SENATE)/im).filter((p) => /RCS#|RSN#/.test(p));
  let offset = 0;
  for (const part of parts) {
    const at = raw.indexOf(part, offset);
    offset = at + part.length;
    const start = (raw.slice(0, at + 1).match(/@@P\d+@@/g) ?? []).length || 1; // pdf page the block starts on
    const text = part.replace(/@@P\d+@@\n?/g, "");
    if (!new RegExp(`\\b20${b.session.slice(0, 2)} Regular Session`).test(text)) { drop("other-session"); continue; } // carried-over bill numbers also list the prior year's votes
    const chamber = /SENATE/i.test(text.split("\n", 2).join(" ")) ? "upper" : "lower";
    found[chamber]++;
    const head = /^(HB|SB|HJR|SJR|HCR|SCR)\s+(\d+)\s*(.*?)\s*(RCS#|RSN#)\s*(\d+)/ms.exec(text.slice(text.search(/\d{4} (Regular|Special) Session/)).replace(/^[^\n]*\n/, ""));
    const date = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
    const motion = /\d{1,2}:\d{2}:\d{2}\s*[AP]M\s*([\s\S]*?)\n\s*YEAS:/.exec(text);
    if (!head || !date || !motion) { drop("unparsed-header"); if (args.includes("--dry")) console.log("HDR", b.id, JSON.stringify(text.slice(0, 400))); continue; }
    const iso = `${date[3]}-${date[1].padStart(2, "0")}-${date[2].padStart(2, "0")}`;
    const bill = `${head[1]} ${head[2]}`;
    const seq = +head[5];
    const id = `ky-${chamber === "lower" ? "h" : "s"}-${b.session}-${seq}`;
    if (seen.has(id)) { drop("duplicate-id"); continue; }
    const tally = {};
    for (const m of text.matchAll(/^(YEAS|NAYS|ABSTAINED|PASSES|NOT VOTING):\s*(\d+)/gm)) tally[m[1]] = +m[2];
    const heads = [...text.matchAll(NAME_HEAD)];
    const lists = {};
    heads.forEach((h, i) => { lists[h[1]] = { count: +h[2], body: text.slice(h.index + h[0].length, heads[i + 1]?.index ?? text.length) }; });
    const slotOf = { YEAS: "yes", NAYS: "no", ABSTAINED: "present", PASSES: "present", "NOT VOTING": "absent" };
    const ctx = { session: b.session, here: new Set([...text.matchAll(/\b([A-Z][A-Za-z'-]+) ([A-Z])\.?(?=\s|$)/gm)].map((m) => norm(m[1]) + m[2].toLowerCase())) };
    const votes = {}; let bad = false;
    for (const [name, { count, body }] of Object.entries(lists)) {
      if (tally[name] !== count) { drop("tally-header-mismatch"); bad = true; break; }
      const ids = count ? parseNames(chamber, body.trim(), count, iso, ctx) : [];
      if (!ids) { drop(`unmatched-or-count-mismatch(${name})`); if (args.includes("--dry")) console.log("BAD", b.session, b.id, iso, name, count); bad = true; break; }
      for (const pid of ids) votes[pid] = slotOf[name];
    }
    if (bad) continue;
    if (!lists.YEAS || !lists.NAYS) { drop("missing-list"); continue; }
    const total = Object.values(tally).reduce((a, n) => a + n, 0);
    if (Object.keys(votes).length !== total) { drop("duplicate-member"); continue; }
    seen.add(id);

    const mot = motion[1].replace(/\s+/g, " ").trim();
    const mod = head[3].replace(/\s+/g, " ").trim();
    const extras = (t) => [...t.matchAll(/([A-Za-z]{3,5})\s*(\d+)/g)].map((m) => (AMEND[m[1].toUpperCase()] ? `${AMEND[m[1].toUpperCase()]} ${m[2]}` : m[0])).join(", ");
    const withs = /\bw\/\s*(.+)$/i.exec(mot);
    const tail = withs ? ` (with ${extras(withs[1])})` : "";
    let question;
    if (/^(override veto|veto override)/i.test(mot)) question = "Override veto: final passage";
    else if (/^consent passage/i.test(mot)) question = `Consent passage${tail}`;
    else if (/^final passage/i.test(mot)) question = `Final passage${tail}`;
    else if (/^pass\b/i.test(mot)) question = `Passage${tail}`;
    else if (/^adopt\b/i.test(mot)) question = mod ? `Adopt ${expand(mod)}` : "Adopt resolution";
    else if (/^[HS]?[A-Z]{2,4} ?\d+$/i.test(mot)) question = `Adopt ${expand(mot.toUpperCase())}`;
    else question = mod ? `${mot} (${expand(mod)})` : mot;
    const isPassage = /^(final passage|passage|consent passage|override)/i.test(question);
    // The vote-history PDFs print no result line, so the outcome is the tally against the required threshold.
    // Ky. Const. §46: passage of a bill needs a majority of members elected (51 House / 20 Senate).
    // House Rule 74 (2026 rules, HR 2 of 26RS): no rule may be "suspended or interrupted, unless the same be done by a
    // majority of the members elected to the House" (51), so "Suspend the Rules" at 21–12 failed.
    const need = isPassage && /^(HB|SB)$/.test(head[1]) ? (chamber === "lower" ? 51 : 20)
      : chamber === "lower" && /^suspend the rules/i.test(question) ? 51 : 0;
    const yes = tally.YEAS, no = tally.NAYS;
    rolls[chamber].push({
      id, bill, date: iso, chamber, question,
      kind: classify({ motion_text: question, motion_classification: isPassage ? ["passage"] : [] }),
      outcome: `${yes > no && yes >= need ? "Passed" : "Failed"} ${yes}–${no}`,
      dateLabel: `${MONTHS[+date[1] - 1]} ${+date[2]}, ${date[3]}`,
      sourceUrl: `${BASE}/${b.session}/${b.id}/vote_history.pdf#page=${start}`,
      billKey: `${b.session}/${b.id}`,
      votes,
    });
  }
}
const total = (c) => rolls[c].length;
console.log(`found ${found.lower}/${found.upper} vote blocks; kept ${total("lower")} House, ${total("upper")} Senate before titles`);
if (args.includes("--dry")) { console.log("dropped:", drops, "\nambiguous:", Object.fromEntries(ambiguous), "\nunmatched:", Object.fromEntries(unmatched)); process.exit(0); }

// ---------------------------------------------------------------- titles
const titles = new Map();
for (const key of new Set([...rolls.lower, ...rolls.upper].map((r) => r.billKey))) {
  const [session, id] = key.split("/");
  const html = await cachedText(`${BASE}/${session}/${id}.html`, join(work, "page", `${session}-${id}.html`));
  const t = /<th>Title<\/th>\s*<td>([\s\S]*?)<\/td>/.exec(html)?.[1];
  titles.set(key, t ? decodeXml(t) : null);
}
const noTitle = new Set();
const now = new Date().toISOString();
for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  for (const r of list) { r.title = titles.get(r.billKey) || (noTitle.add(r.bill), r.bill); delete r.billKey; }
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id, "en", { numeric: true }));
  await writeSnapshot(join(OUT, `state-ky-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("ky", chamber),
    sourceLabel: `Roll call · Kentucky ${chamber === "lower" ? "House" : "Senate"} floor votes (Kentucky General Assembly vote histories)`,
    keyBy: "openstates",
    jurisdiction: "ky",
    legislativeChamber: chamber,
    rollCalls: list.map(({ chamber: _c, ...r }) => r),
  }, { compact: true });
  const dates = list.map((r) => r.date).sort();
  console.log(`${chamber}: ${list.length} roll calls ${dates[0]}..${dates.at(-1)}`);
}
console.log("dropped:", drops);
console.log("bills without a title:", [...noTitle]);
console.log("unmatched names:", Object.fromEntries(unmatched));
