#!/usr/bin/env node
/**
 * Landmark NY Assembly floor votes for voter-guide candidates.
 *
 * Reads the official nyassembly.gov (LRS) floor-vote tables for a short list of
 * bills that squarely address a guide issue statement, resolves each member via
 * the current Assembly roster, and matches members to candidates in NY races by
 * name. Tallies are checked against the printed YEA/NAY before use.
 *
 * Writes content/guide/generated/ny-landmark-votes.json
 *   { "<raceId>/<candidateId>": [StateVote & { id }] }
 *
 * Run: node scripts/guide/ny-landmark.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyMark, normalizeName, parseFloorVotes, resolveNames, rosterFromHtml } from "../ingest/lrs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GUIDE = join(ROOT, "content/guide");

/** Bill print numbers as nyassembly.gov lists them; `term` is the session's first year. */
export const NY_LANDMARK = [
  { id: "nya-2019-S06458", bill: "S6458", term: 2019, title: "Housing Stability and Tenant Protection Act of 2019", summary: "Made rent regulation permanent, ended vacancy decontrol and the vacancy bonus, and limited rent increases for major capital improvements." },
  { id: "nya-2019-S06599", bill: "S6599", term: 2019, title: "Climate Leadership and Community Protection Act", summary: "Set statewide targets of 70% renewable electricity by 2030 and an 85% cut in greenhouse-gas emissions by 2050." },
  { id: "nya-2019-S02451", bill: "S2451", term: 2019, title: "Extreme risk protection orders (red-flag law)", summary: "Allows courts to temporarily bar people found to pose a danger to themselves or others from possessing firearms." },
  { id: "nya-2019-S00240", bill: "S240", term: 2019, title: "Reproductive Health Act", summary: "Moved abortion from the penal code to the public-health law and protected access to abortion under state law." },
  { id: "nya-2019-A02176", bill: "A2176", term: 2019, title: "Protect Our Courts Act", summary: "Bars federal civil immigration arrests of people going to, attending, or leaving New York courthouses without a judicial warrant." },
  { id: "nya-2021-S51001", bill: "S51001", term: 2021, title: "Concealed Carry Improvement Act", summary: "Enacted after the Bruen decision: added training and character requirements for carry permits and barred guns in designated sensitive places." },
  { id: "nya-2021-S02509", bill: "S2509", term: 2021, title: "2021–22 budget revenue bill", summary: "Raised personal income tax rates on incomes above $1 million and raised the corporate franchise tax rate on large businesses, among other revenue measures." },
];

const UA = "Mozilla/5.0 (compatible; thefullrecord-ingest/1.0; civic transparency)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  await sleep(300);
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}
const pad = (b) => b.replace(/^([A-Z])(\d+)$/, (_, p, n) => p + n.padStart(5, "0"));

// ---------- candidates in NY races
const races = readdirSync(join(GUIDE, "races"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(GUIDE, "races", f), "utf8")))
  .filter((r) => r.state === "NY");
const SUFFIX = /^(jr|sr|ii|iii|iv)$/;
const parts = (n) => {
  const w = normalizeName(n.replace(/\(.*?\)|".*?"/g, " ")).split(" ").filter((x) => x && !SUFFIX.test(x));
  return { first: w[0] ?? "", last: w.at(-1) ?? "", full: w.join(" ") };
};
function candidatesFor(memberName) {
  const m = parts(memberName);
  const hits = [];
  for (const race of races)
    for (const c of race.candidates) {
      const p = parts(c.name);
      if (p.last === m.last && (p.first === m.first || p.first.startsWith(m.first) || m.first.startsWith(p.first)))
        hits.push(`${race.id}/${c.id}`);
    }
  return hits;
}

const roster = rosterFromHtml(await get("https://nyassembly.gov/mem/"));
console.log(`roster: ${roster.length} members`);

const out = {};
for (const lm of NY_LANDMARK) {
  const url = `https://nyassembly.gov/leg/?default_fld=&leg_video=&bn=${pad(lm.bill)}&term=${lm.term}&Summary=Y&Actions=Y&Floor%26nbspVotes=Y`;
  const votes = parseFloorVotes(await get(url)).filter((v) => v.assembly);
  // Final passage = the last Assembly floor vote on the bill.
  const v = votes.at(-1);
  if (!v) {
    console.warn(`${lm.id}: no Assembly floor vote found — skipped`);
    continue;
  }
  const tally = { yes: 0, no: 0 };
  for (const e of v.entries) {
    const k = classifyMark(e.mark);
    if (k === "yes") tally.yes++;
    if (k === "no") tally.no++;
  }
  if (tally.yes !== v.printedYes || tally.no !== v.printedNo) {
    console.warn(`${lm.id}: tally mismatch ${tally.yes}/${tally.no} vs printed ${v.printedYes}/${v.printedNo} — skipped`);
    continue;
  }
  const names = resolveNames([...new Set(v.entries.map((e) => e.nameKey))], roster);
  const byDistrict = new Map(roster.map((m) => [m.district, m]));
  let matched = 0;
  for (const e of v.entries) {
    const district = names.get(e.nameKey);
    const mark = classifyMark(e.mark);
    if (!district || !mark) continue;
    const member = byDistrict.get(district);
    const keys = candidatesFor(member.name);
    if (keys.length !== 1) continue;
    (out[keys[0]] ??= []).push({
      id: lm.id,
      chamber: "assembly",
      bill: lm.bill,
      title: lm.title,
      summary: lm.summary,
      outcome: `Passed ${v.printedYes}–${v.printedNo}`,
      date: v.date,
      vote: mark,
      sourceUrl: url,
    });
    matched++;
  }
  console.log(`${lm.id} ${v.date} ${v.printedYes}–${v.printedNo}: ${matched} candidates`);
}
writeFileSync(join(GUIDE, "generated/ny-landmark-votes.json"), JSON.stringify(out, null, 1));
console.log(`wrote landmark votes for ${Object.keys(out).length} candidates`);
