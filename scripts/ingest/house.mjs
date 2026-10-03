/**
 * One-off ingest: U.S. House roll calls (2026 session) from the House
 * Clerk's official XML at clerk.house.gov — keyless.
 *
 * Writes src/server/snapshot/house.json with every member's position (all
 * states, DC and the territories' delegates) on the most recent recorded
 * votes, keyed by bioguide id. memberKeys maps "{st}-{n|al}" -> bioguide
 * (at-large seats and delegates use "al").
 *
 * Default: every recorded roll call of the 119th Congress (2025 and 2026).
 * Roll calls already in the snapshot are reused rather than refetched
 * (recorded votes do not change); pass --refetch to re-download them.
 *
 * Run: node scripts/ingest/house.mjs [--all | --year 2026 [--year 2025]] [--count N] [--refetch]
 *   --count N  only the N most recent rolls of each selected year
 * Votes are stored compactly (see compactSnapshot in shared.mjs).
 */

import { readFile } from "node:fs/promises";
import { decodeXml, expandSnapshot, federalVote, politeGet, writeSnapshot } from "./shared.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot/house.json");
const ARGS = process.argv.slice(2);
const argValues = (flag) => ARGS.flatMap((a, i) => (a === flag ? [ARGS[i + 1]] : []));
const CONGRESS_YEARS = [2025, 2026]; // 119th Congress
const YEARS = argValues("--year").length ? argValues("--year").map(Number) : CONGRESS_YEARS;
if (YEARS.some((y) => !CONGRESS_YEARS.includes(y))) throw new Error(`--year must be one of ${CONGRESS_YEARS.join(", ")}`);
const COUNT = argValues("--count")[0] === undefined ? Infinity : Number(argValues("--count")[0]);
if (!(COUNT >= 1)) throw new Error("--count must be a positive integer");
const REFETCH = ARGS.includes("--refetch");

async function fetchText(url) {
  const res = await politeGet(url, { allow404: true, minGapMs: 150 });
  return res ? res.text() : null;
}

const tag = (xml, name) =>
  decodeXml(xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`))?.[1] ?? "");

/** "H RES 1399" -> "H.Res. 1399", "H R 8464" -> "H.R. 8464" */
function formatBillNumber(legisNum) {
  return legisNum
    .replace(/^H R /, "H.R. ")
    .replace(/^H RES /, "H.Res. ")
    .replace(/^H CON RES /, "H.Con.Res. ")
    .replace(/^H J RES /, "H.J.Res. ")
    .replace(/^S CON RES /, "S.Con.Res. ")
    .replace(/^S J RES /, "S.J.Res. ")
    .replace(/^S RES /, "S.Res. ")
    .replace(/^S /, "S. ");
}

const PROCEDURAL =
  /journal|previous question|motion to adjourn|motion to table|motion to recommit|motion to refer|call of the house|quorum/i;

const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/** "30-Jun-2026" -> ["2026-06-30", "Jun 30, 2026"] */
function parseActionDate(s) {
  const m = s.match(/(\d+)-([A-Za-z]{3})-(\d{4})/);
  if (!m) return [null, s];
  const [, d, mon, y] = m;
  const iso = `${y}-${MONTHS[mon]}-${d.padStart(2, "0")}`;
  return [iso, `${mon} ${Number(d)}, ${y}`];
}

const mapVote = federalVote;

const isRoll = (xml) => typeof xml === "string" && xml.includes("<rollcall-vote");

/**
 * Latest roll number. The Clerk's yearly index page is the primary source;
 * when it is missing (it has returned 404) probe the roll XML files directly
 * with a binary search — unpublished rolls come back as a 200 error stub, so
 * "is a real roll call" means the XML contains <rollcall-vote>.
 */
async function findLatestRoll(YEAR) {
  const index = await fetchText(`https://clerk.house.gov/evs/${YEAR}/index.asp`).catch(() => null);
  const rolls = [...(index ?? "").matchAll(/rollnumber=(\d+)/gi)].map((match) => Number(match[1]));
  if (rolls.length) return Math.max(...rolls);
  console.log("House index unavailable; probing roll XML files directly…");
  const exists = async (n) => isRoll(await fetchText(`https://clerk.house.gov/evs/${YEAR}/roll${String(n).padStart(3, "0")}.xml`).catch(() => null));
  if (!(await exists(1))) throw new Error("House roll 1 not found; keeping previous snapshot");
  let lo = 1;
  let hi = 2;
  while (await exists(hi)) { lo = hi; hi *= 2; if (hi > 4000) throw new Error("Implausible House roll count"); }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await exists(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

async function main() {
  const latestByYear = {};
  for (const year of YEARS) {
    console.log(`Probing for the latest ${year} House roll call…`);
    latestByYear[year] = await findLatestRoll(year);
    if (!latestByYear[year]) throw new Error(`No ${year} rolls found`);
    console.log(`  ${year}: latest roll ${latestByYear[year]}`);
  }

  let previous = [];
  try { previous = expandSnapshot(JSON.parse(await readFile(OUT, "utf8"))).rollCalls; } catch { /* first run */ }
  const known = new Map(previous.map((rc) => [rc.id, rc]));

  // Seat -> bioguide map for every House seat, from the congress-legislators dataset.
  const legislators = JSON.parse(
    await fetchText("https://unitedstates.github.io/congress-legislators/legislators-current.json")
  );
  const memberKeys = {};
  for (const leg of legislators) {
    const term = leg.terms[leg.terms.length - 1];
    if (term.type === "rep")
      memberKeys[`${term.state.toLowerCase()}-${term.district ? term.district : "al"}`] = leg.id.bioguide;
  }
  if (Object.keys(memberKeys).length < 400) throw new Error("congress-legislators House roster looks incomplete; keeping previous snapshot");

  // Years not selected this run keep their previously ingested roll calls.
  const rollCalls = previous.filter((rc) => !YEARS.includes(Number(rc.id.split("-")[1])));
  const jobs = YEARS.flatMap((year) => {
    const latest = latestByYear[year];
    const out = [];
    for (let roll = latest; roll > latest - COUNT && roll > 0; roll--) out.push([year, roll]);
    return out;
  });
  for (const [YEAR, roll] of jobs) {
    const reused = !REFETCH && known.get(`house-${YEAR}-${roll}`);
    if (reused) { rollCalls.push(reused); continue; }
    const rollId = String(roll).padStart(3, "0");
    const xml = await fetchText(`https://clerk.house.gov/evs/${YEAR}/roll${rollId}.xml`);
    if (!isRoll(xml)) throw new Error(`Missing House roll call ${roll}; keeping previous snapshot`);

    const question = tag(xml, "vote-question");
    // Speaker elections record a candidate name per member, not yea/nay; they
    // do not fit the yes/no/present/absent model, so they are not imported.
    if (/^election of the speaker/i.test(question) || tag(xml, "vote-type").toUpperCase() === "ELECTION") {
      console.log(`  roll ${roll}: ${question} (election by candidate name) — skipped`);
      continue;
    }
    const result = tag(xml, "vote-result");
    const legisNum = tag(xml, "legis-num");
    const desc = tag(xml, "vote-desc");
    const [date, dateLabel] = parseActionDate(tag(xml, "action-date"));
    if (!date) throw new Error(`Unparseable House date for roll ${roll}`);
    // Overall tallies live in <totals-by-vote>; per-party blocks also carry
    // yea-total/nay-total, so scope the match.
    const totals = xml.match(
      /<totals-by-vote>[\s\S]*?<yea-total>(\d+)<\/yea-total>[\s\S]*?<nay-total>(\d+)<\/nay-total>/
    );
    const [yea, nay] = totals ? [totals[1], totals[2]] : ["", ""];

    const votes = {};
    const re = /<legislator name-id="([A-Z]\d+)"[^>]*>[^<]*<\/legislator>\s*<vote>([^<]+)<\/vote>/g;
    for (const m of xml.matchAll(re)) votes[m[1]] = mapVote(m[2]);
    if (!Object.keys(votes).length) continue; // not a recorded member vote

    const bill = legisNum ? formatBillNumber(legisNum) : question;
    rollCalls.push({
      id: `house-${YEAR}-${roll}`,
      bill,
      title: desc || question,
      question,
      kind: PROCEDURAL.test(question) || /providing for (consideration|further consideration)/i.test(desc) ? "procedural" : "substantive",
      outcome: `${result} ${yea}–${nay}`,
      date,
      dateLabel,
      sourceUrl: `https://clerk.house.gov/Votes/${YEAR}${roll}`,
      votes,
    });
    console.log(`  roll ${roll}: ${bill} — ${result} ${yea}–${nay} (${question})`);
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    chamber: "U.S. HOUSE",
    sourceLabel: "Roll call · U.S. House",
    sessionRollCallTotal: Object.values(latestByYear).reduce((a, b) => a + b, 0),
    memberKeys,
    rollCalls: rollCalls.sort((a, b) => b.date.localeCompare(a.date) || Number(b.id.split("-")[2]) - Number(a.id.split("-")[2])),
  };
  await writeSnapshot(OUT, snapshot, { compact: true });
  console.log(`\nWrote ${rollCalls.length} roll calls, ${Object.keys(memberKeys).length} seats -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
