/**
 * Arizona 57th Legislature (2025 1st Regular, 2026 2nd Regular) floor votes from the Legislature's own API
 * (https://apps.azleg.gov/api/, the one behind azleg.gov bill overview pages).
 * Replaces the sampled Open States files state-az-{lower,upper}.json with every House and Senate
 * Third Reading / Final Reading roll call, plus the Senate fact sheet or House summary as the (official) bill summary.
 *
 * Endpoints used:
 *   Session/                                  session ids (129 = 2025 1R, 130 = 2026 2R)
 *   Bill/?billNumber=HB2001&sessionId=129     bill id, short title (there is no list endpoint, so bill numbers are probed)
 *   BillStatusFloorAction/?billStatusId=ID    floor actions; THIRD / FINAL rows carry per-member Votes (Legislator + Y/N/...)
 *   DocType/?billStatusId=ID                  document links; the latest "SENATE FACT SHEET" / "HOUSE SUMMARY" supplies the summary
 * Committee of the Whole has no recorded votes and committee votes are not floor votes, so neither is imported.
 * Members are keyed "ocd-person/<uuid>": the Open States roster (https://data.openstates.org/people/current/az.csv) links
 * each person to azleg.gov's LegislatorId; former members fall back to Open States' retired list by full name.
 *
 * Run: node scripts/ingest/az-leg.mjs [--work dir]   (responses are cached in --work, default OS temp dir; ~3 requests/second)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { decodeXml, politeGet, writeSnapshot } from "./shared.mjs";
import { billSummary, classify, snapshotChamberName } from "./openstates-transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot");
const API = "https://apps.azleg.gov/api";
const ROSTER_URL = "https://data.openstates.org/people/current/az.csv";
const SESSIONS = [129, 130];
// first bill number per type (HB/HCR/HJR from 2001, Senate from 1001); probing stops after a run of missing numbers
const TYPES = { HB: 2001, HCR: 2001, HJR: 2001, SB: 1001, SCR: 1001, SJR: 1001 };
const GAP = 30;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHAMBER = { H: "lower", S: "upper" };
const POSITION = { Y: "yes", N: "no", NV: "absent", X: "absent", E: "absent", A: "absent", P: "present" };

const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const work = flag("--work") ?? join(tmpdir(), "az-leg");
mkdirSync(work, { recursive: true });

/** Cached GET (≤ ~3 requests/second when uncached). Returns text, or null on 404. */
async function get(url) {
  const file = join(work, createHash("sha1").update(url).digest("hex"));
  if (existsSync(file)) return readFileSync(file, "utf8");
  for (let attempt = 0; ; attempt++) {
    try { // body reads can time out after the headers arrive, so retry the whole request
      const res = await politeGet(url, { minGapMs: 350, allow404: true });
      if (!res) return null;
      const text = new TextDecoder(url.includes("/legtext/") ? "windows-1252" : "utf-8").decode(await res.arrayBuffer());
      writeFileSync(file, text);
      return text;
    } catch (e) { if (attempt >= 3) throw e; }
  }
}
const getJson = async (url) => { const t = await get(url); return t ? JSON.parse(t) : null; };

const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

function csv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// --- Roster: azleg LegislatorId -> Open States person (roster links carry legislator=<id>), retired list by full name.
const people = csv(await (await politeGet(ROSTER_URL)).text());
const byLegislatorId = new Map();
for (const p of people) for (const m of (p.links ?? "").matchAll(/legislator=(\d+)/g)) byLegislatorId.set(Number(m[1]), p.id);
const byName = new Map(people.map((p) => [`${p.current_chamber}:${norm(p.given_name)}${norm(p.family_name)}`, p.id]));
const retired = new Map();
try {
  const listing = await (await politeGet("https://api.github.com/repos/openstates/people/contents/data/az/retired", { headers: { Accept: "application/vnd.github+json" } })).json();
  for (const { name } of listing) {
    const m = /^(.+)-([0-9a-f]{8}-[0-9a-f-]{27})\.yml$/.exec(name);
    if (m) retired.set(norm(m[1]), `ocd-person/${m[2]}`);
  }
} catch (e) { console.warn(`retired-member list unavailable (${e.message}); departed members stay unmatched`); }
const personFor = (leg, chamber) => {
  const last = leg.LastName.replace(/,?\s+(Sr|Jr|II|III)\.?$/i, ""); // "Marshall, Sr." -> "Marshall"
  return byLegislatorId.get(leg.LegislatorId) ?? byName.get(`${chamber}:${norm(leg.FirstName)}${norm(last)}`) ?? retired.get(norm(`${leg.FirstName} ${last}`));
};

/** Summary text from a Senate fact sheet (Purpose … Background) or House summary (Overview … History). */
function factSheetText(html) {
  const text = decodeXml(html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<head[\s\S]*?<\/head>/gi, " "));
  const part = /\bPurpose\b(.*?)(?:\bBackground\b|\bProvisions\b|$)/.exec(text) ?? /\bOverview\b(.*?)(?:\bHistory\b|\bProvisions\b|\bBackground\b|$)/.exec(text);
  return part?.[1]?.trim() ?? "";
}

const now = new Date().toISOString();
const today = now.slice(0, 10);
const rolls = { lower: [], upper: [] };
const unmatched = new Map(); const skipped = {}; const codes = {};
let tallyMismatch = 0, bills = 0;
const skip = (why) => { skipped[why] = (skipped[why] ?? 0) + 1; };

for (const sessionId of SESSIONS) {
  for (const [type, first] of Object.entries(TYPES)) {
    let missing = 0;
    for (let n = first; missing < GAP; n++) {
      const number = `${type}${n}`;
      const bill = await getJson(`${API}/Bill/?billNumber=${number}&sessionId=${sessionId}`);
      if (!bill?.BillId) { missing++; continue; }
      missing = 0; bills++;
      const actions = (await getJson(`${API}/BillStatusFloorAction/?billStatusId=${bill.BillId}`)) ?? [];
      const voted = actions.filter((a) => a.Votes?.length && ["THIRD", "FINAL"].includes(a.CommitteeShortName));
      if (!voted.length) continue;
      const title = (bill.ShortTitle ?? "").trim();
      if (!title) { skip("no-bill-title"); continue; }
      let info = {};
      const docs = (await getJson(`${API}/DocType/?billStatusId=${bill.BillId}`)) ?? [];
      const sheet = docs.flatMap((g) => g.Documents).filter((d) => /^(SENATE FACT SHEET|HOUSE SUMMARY)/i.test(d.DocumentName) && d.HtmlPath).at(-1);
      if (sheet) {
        const html = await get(sheet.HtmlPath);
        const abstract = html ? factSheetText(html) : "";
        if (abstract) info = billSummary({ title, abstracts: [{ abstract }] });
      }
      for (const a of voted) {
        const chamber = CHAMBER[a.Votes[0].Legislator?.Body];
        const day = String(a.ReportDate ?? a.AssignedDate ?? "").slice(0, 10);
        if (!chamber || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today) { skip("bad-chamber-or-date"); continue; }
        const votes = {};
        let ayes = 0, noes = 0;
        for (const v of a.Votes) {
          codes[v.Vote] = (codes[v.Vote] ?? 0) + 1;
          if (v.Vote === "Y") ayes++; else if (v.Vote === "N") noes++;
          const position = POSITION[v.Vote];
          const id = personFor(v.Legislator, chamber);
          if (!id) { const k = `${chamber}:${v.Legislator.FullName}`; unmatched.set(k, (unmatched.get(k) ?? 0) + 1); continue; }
          if (position) votes[id] = position;
        }
        if (!Object.keys(votes).length) { skip("no-matched-voters"); continue; }
        if (ayes !== a.Ayes || noes !== a.Nays) tallyMismatch++;
        // Official result: the floor action's Action text ("Passed", "failed to pass"); every 2025-26 Third/Final Reading
        // roll call carries one. Without it, fall back to Ariz. Const. art. IV, pt. 2, §15 ("A majority of all members elected
        // to each house shall be necessary to pass any bill": 31 of 60, 16 of 30) and report the row for a manual check.
        let passed = /^pass|adopt/i.test(a.Action ?? "") ? true : /^fail|reject|lost/i.test(a.Action ?? "") ? false : null;
        if (passed === null) {
          passed = ayes > noes && ayes >= (chamber === "lower" ? 31 : 16);
          console.warn(`no official result for ${number} ${a.CommitteeShortName} ${day} (Action ${JSON.stringify(a.Action)}): ${ayes}-${noes} scored ${passed ? "Passed" : "Failed"}`);
        }
        const question = a.CommitteeName;
        rolls[chamber].push({
          id: `az-${sessionId}-${number}-${a.CommitteeShortName}-${a.ReferralNumber}-${String(a.ReportDate).replace(/\D/g, "")}`,
          bill: `${type} ${n}`,
          title,
          ...info,
          question,
          kind: classify({ motion_text: question, motion_classification: ["passage"] }),
          outcome: `${passed ? "Passed" : "Failed"} ${ayes}–${noes}`,
          date: day,
          dateLabel: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${day.slice(0, 4)}`,
          sourceUrl: `https://apps.azleg.gov/BillStatus/BillOverview/${bill.BillId}`,
          votes,
        });
      }
    }
    console.log(`session ${sessionId} ${type}: probed through ${type}${first}+ (bills so far ${bills})`);
  }
}

for (const chamber of ["lower", "upper"]) {
  const list = rolls[chamber];
  list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const label = snapshotChamberName("az", chamber);
  const name = chamber === "lower" ? "House" : "Senate";
  await writeSnapshot(join(OUT, `state-az-${chamber}.json`), {
    generatedAt: now,
    chamber: label,
    sourceLabel: `Roll call · Arizona ${name} floor votes (Arizona State Legislature)`,
    keyBy: "openstates",
    jurisdiction: "az",
    legislativeChamber: chamber,
    rollCalls: list,
  }, { compact: true });
  console.log(`${chamber}: ${list.length} roll calls, ${list.filter((r) => r.summary).length} with an official summary`);
}
console.log("vote codes:", codes, "| skipped:", skipped, "| tally mismatches:", tallyMismatch);
console.log("unmatched member names (votes dropped):", Object.fromEntries(unmatched));
