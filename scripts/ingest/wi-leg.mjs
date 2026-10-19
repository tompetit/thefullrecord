/**
 * Wisconsin 2025-26 Legislature floor roll calls from the Legislature's own document site (https://docs.legis.wisconsin.gov).
 * Replaces any sampled Open States files state-wi-{lower,upper}.json with every Assembly and Senate roll call the Legislature
 * publishes for the biennium (including amendment, table and ruling-of-the-chair votes; those are classed "procedural").
 *
 * Pages (server-rendered HTML, plain GET):
 *   /2025/related/votes/assembly/av{NNNN}, /senate/sv{NNNN}   bill, short title, motion, tallies, per-member votes by SURNAME, date
 *   /2025/proposals/{sb182}                                   official "Relating to:" title of the bill
 * The vote numbers run 1.. per chamber; the index pages (/2025/related/votes/{assembly,senate}) give the highest.
 * Members are keyed "ocd-person/<uuid>" via https://data.openstates.org/people/current/wi.csv by chamber + surname (Assembly pages
 * add ", B" initials for shared surnames; the Speaker row is listed as SPEAKER) then Open States' retired list. A name that fits
 * several people is dropped and reported. The Assembly marks "not voting" with x and paired members with P; stored as "absent".
 * The state publishes no plain-language bill summary on these pages, so none is stored.
 *
 * Responses are cached in --work (default ~/.cache/wi-leg); <= 2 requests/second.
 * Run: node scripts/ingest/wi-leg.mjs [--work dir]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const SITE = "https://docs.legis.wisconsin.gov";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const args = process.argv.slice(2);
const work = args.includes("--work") ? args[args.indexOf("--work") + 1] : join(homedir(), ".cache/wi-leg");
mkdirSync(work, { recursive: true });

/** Cached GET returning HTML text (null on 404). */
async function get(path, name) {
  const file = join(work, name);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const res = await politeGet(`${SITE}${path}`, { minGapMs: 500, retries: 6, allow404: true });
  if (!res) return null;
  const text = await res.text();
  writeFileSync(file, text);
  return text;
}
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const text = (html) => decodeXml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
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

// --- Roster. (The Senate pages print Dassler-Alfheim as DASSLER-ALFHEI; person() corrects it.)
const people = csv(await (await politeGet("https://data.openstates.org/people/current/wi.csv")).text());
const cands = []; // { id, given, names, chamber (current members only) }
for (const p of people) cands.push({ id: p.id, given: norm(p.given_name), names: new Set([norm(p.family_name), norm(p.family_name.split(" ").at(-1))]), chamber: p.current_chamber });
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/wi/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (!m) continue;
    const [given, ...rest] = m[1].split("-").filter((t) => t.length > 1);
    cands.push({ id: `ocd-person/${m[2]}`, given: norm(given), names: new Set([norm(rest.join("")), norm(rest.at(-1) ?? "")]), chamber: null });
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const unmatched = new Map(); const ambiguous = new Map();
const speaker = people.find((p) => p.current_chamber === "lower" && /^Vos$/i.test(p.family_name))?.id;
/** Open States id for a vote-page name ("JACOBSON, B" carries a first initial); null (and counted) when unknown or ambiguous. */
function person(chamber, label) {
  if (chamber === "lower" && label === "SPEAKER") return speaker ?? null;
  const m = /^(.*\S),\s*([A-Z])\.?$/.exec(label.trim());
  const k = norm(m ? m[1] : label).replace(/^dassleralfhei$/, "dassleralfheim"), initial = m?.[2].toLowerCase();
  const fits = cands.filter((c) => c.names.has(k) && (!initial || c.given[0] === initial));
  for (const stage of [fits.filter((c) => c.chamber === chamber), fits.filter((c) => !c.chamber), fits.filter((c) => c.chamber && c.chamber !== chamber)]) {
    const ids = [...new Set(stage.map((c) => c.id))];
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) { ambiguous.set(`${chamber}:${label}`, (ambiguous.get(`${chamber}:${label}`) ?? 0) + 1); return null; }
  }
  return null;
}

// --- Vote pages.
const CHAMBERS = { lower: ["assembly", "av"], upper: ["senate", "sv"] };
const maxId = {};
for (const [ch, [dir, pre]] of Object.entries(CHAMBERS)) {
  const idx = await get(`/2025/related/votes/${dir}`, `index-${dir}.html`) ?? "";
  maxId[ch] = Math.max(...[...idx.matchAll(new RegExp(`${pre}(\\d{4})`, "g"))].map((m) => Number(m[1])));
}
console.log("highest vote numbers:", maxId);

const now = new Date().toISOString();
const rolls = { lower: [], upper: [] };
const skipped = {}; const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };
const billTitles = new Map();
let tallyMismatch = 0;
for (const [chamber, [dir, pre]] of Object.entries(CHAMBERS)) {
  for (let n = 1; n <= maxId[chamber]; n++) {
    const id = `${pre}${String(n).padStart(4, "0")}`;
    if (n % 100 === 0) console.log(`${chamber} ${n}/${maxId[chamber]}`);
    const page = await get(`/2025/related/votes/${dir}/${id}`, `${id}.html`);
    if (!page) { skip("vote-404"); continue; }
    const body = page.slice(page.indexOf('<div id="document"'));
    const head = /<p>\s*<b style="font-size: 1.2em">([\s\S]*?)<\/p>/.exec(body)?.[1];
    const dm = /(\w+) (\d{1,2}), (\d{4}) \d{1,2}:\d\d [AP]M/.exec(text(body.slice(body.lastIndexOf("SEQUENCE NO."))));
    if (!head || !dm || !MONTH_NAMES.includes(dm[1])) { skip("unparsed-header-or-date"); continue; }
    const date = `${dm[3]}-${String(MONTH_NAMES.indexOf(dm[1]) + 1).padStart(2, "0")}-${dm[2].padStart(2, "0")}`;
    // <b>BILL</b><br>BY AUTHOR<br>SHORT TITLE<br><b>QUESTION</b><br>AMENDMENT OFFERED BY X
    const [billHtml, ...lines] = head.replace(/^([\s\S]*?)<\/b>/, "$1\n").split(/<br\s*\/?>|\n/i);
    const bill = text(billHtml);
    const qIdx = lines.findIndex((l) => /<b>/.test(l));
    const shortTitle = lines.slice(1, qIdx < 0 ? undefined : qIdx).map(text).filter((l) => l && !/^BY /.test(l)).join(" ");
    const motion = qIdx < 0 ? "" : text(lines[qIdx]);
    const extra = lines.slice(qIdx + 1).map(text).filter(Boolean).join(" ");
    const votes = {}; let yes = 0, no = 0, yea, nay;
    const addVote = (pos, label) => {
      if (pos === "yes") yes++; else if (pos === "no") no++;
      const pid = person(chamber, label);
      if (!pid) { unmatched.set(`${chamber}:${label}`, (unmatched.get(`${chamber}:${label}`) ?? 0) + 1); return; }
      votes[pid] = pos;
    };
    if (chamber === "lower") {
      const t = /AYES - (\d+)\s+NAYS - (\d+)/.exec(text(body));
      yea = Number(t?.[1]); nay = Number(t?.[2]);
      for (const m of body.matchAll(/<tr>\s*<td>(\w?)<\/td>\s*<td>(\w?)<\/td>\s*<td>(\w?)<\/td>\s*<td class="name">([^<]+)<\/td>/g)) {
        addVote(m[1] === "Y" ? "yes" : m[2] === "N" ? "no" : "absent", decodeXml(m[4]));
      }
    } else {
      for (const m of body.matchAll(/<td class="vote-count">([A-Z ]+) - (\d+)<\/td>\s*<td>([\s\S]*?)<\/table>/g)) {
        const pos = m[1] === "AYES" ? "yes" : m[1] === "NAYS" ? "no" : "absent";
        for (const c of m[3].matchAll(/<td>([^<]+)<\/td>/g)) addVote(pos, decodeXml(c[1]));
        if (pos === "yes") yea = Number(m[2]); else if (pos === "no") nay = Number(m[2]);
      }
    }
    if (!Object.keys(votes).length) { skip("no-matched-voters"); continue; }
    if (yes !== yea || no !== nay) { tallyMismatch++; skip(`tally-mismatch`); console.log("tally mismatch", id, yes, yea, no, nay); continue; }
    // Official title: "Relating to: ..." from the bill's history page.
    const slug = bill.toLowerCase().replace(/\s+/g, "");
    if (!billTitles.has(slug)) {
      const p = await get(`/2025/proposals/${slug}`, `bill-${slug}.html`);
      const rel = p && /Relating to:([^()]*?)(?:\(FE\))?\s*Status:/.exec(text(p));
      billTitles.set(slug, rel ? rel[1].trim() : null);
    }
    const officialTitle = billTitles.get(slug);
    const title = officialTitle ? `Relating to: ${officialTitle}` : shortTitle || bill;
    const question = [motion, extra].filter(Boolean).join(" — ") || undefined;
    const passage = /PASSAGE|CONCUR|ADOPTION|CONFIRM|NONCONCUR/i.test(motion) && !/AMENDMENT|TABLE|REFER|CHAIR|RECONSIDER/i.test(`${motion} ${extra}`);
    rolls[chamber].push({
      id: `wi-${id}`,
      bill,
      title,
      question,
      kind: /AMENDMENT|DECISION OF THE CHAIR|LAY ON TABLE|REFER|SUSPEND|CALL THE QUESTION/i.test(motion) ? "procedural" : classify({ motion_text: `${motion} ${extra}`, motion_classification: passage ? ["passage"] : [] }),
      outcome: `${yea > nay ? "Passed" : "Failed"} ${yea}–${nay}`,
      date,
      dateLabel: `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`,
      sourceUrl: `${SITE}/2025/related/votes/${dir}/${id}`,
      votes,
    });
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  await writeSnapshot(join(OUT, `state-wi-${chamber}.json`), {
    generatedAt: now,
    chamber: snapshotChamberName("wi", chamber),
    sourceLabel: `Roll call · Wisconsin ${chamber === "lower" ? "Assembly" : "Senate"} floor votes (Wisconsin Legislature)`,
    keyBy: "openstates",
    jurisdiction: "wi",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list[list.length - 1]?.date} to ${list[0]?.date}`);
}
console.log("skipped:", skipped, "| tally mismatches:", tallyMismatch);
console.log("ambiguous names (votes dropped):", Object.fromEntries(ambiguous));
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
