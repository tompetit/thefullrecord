/**
 * One-off ingest: U.S. House roll calls (2026 session) from the House
 * Clerk's official XML at clerk.house.gov — keyless.
 *
 * Writes src/server/snapshot/house.json with every NY member's position
 * on the most recent recorded votes, keyed by bioguide id.
 *
 * Run: node scripts/ingest/house.mjs [--count 25]
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot/house.json");
const YEAR = 2026;
const COUNT = Number(process.argv.find((a, i) => process.argv[i - 1] === "--count") ?? 25);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { "User-Agent": "thefullrecord-ingest/1.0 (civic transparency)" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

const tag = (xml, name) =>
  xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`))?.[1]?.trim() ?? "";

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

const mapVote = (v) =>
  v === "Yea" || v === "Aye" ? "yes" : v === "Nay" || v === "No" ? "no" : "absent";

async function findLatestRoll() {
  // Probe upward in steps from a known-good floor until misses persist.
  let latest = 0;
  for (let roll = 200; roll < 700; roll += 1) {
    const xml = await fetchText(`https://clerk.house.gov/evs/${YEAR}/roll${String(roll).padStart(3, "0")}.xml`);
    await sleep(120);
    if (xml) latest = roll;
    else if (latest && roll - latest > 3) break;
  }
  return latest;
}

async function main() {
  console.log("Probing for the latest 2026 House roll call…");
  const latest = await findLatestRoll();
  if (!latest) throw new Error("No 2026 rolls found");
  console.log(`Latest roll: ${latest}. Ingesting the ${COUNT} most recent…`);

  // District -> bioguide map for NY, from the congress-legislators dataset.
  const legislators = JSON.parse(
    await fetchText("https://unitedstates.github.io/congress-legislators/legislators-current.json")
  );
  const memberKeys = {};
  for (const leg of legislators) {
    const term = leg.terms[leg.terms.length - 1];
    if (term.state === "NY" && term.type === "rep")
      memberKeys[String(term.district)] = leg.id.bioguide;
  }

  const rollCalls = [];
  for (let roll = latest; roll > latest - COUNT && roll > 0; roll--) {
    const rollId = String(roll).padStart(3, "0");
    const xml = await fetchText(`https://clerk.house.gov/evs/${YEAR}/roll${rollId}.xml`);
    await sleep(150);
    if (!xml) continue;

    const question = tag(xml, "vote-question");
    const result = tag(xml, "vote-result");
    const legisNum = tag(xml, "legis-num");
    const desc = tag(xml, "vote-desc");
    const [date, dateLabel] = parseActionDate(tag(xml, "action-date"));
    // Overall tallies live in <totals-by-vote>; per-party blocks also carry
    // yea-total/nay-total, so scope the match.
    const totals = xml.match(
      /<totals-by-vote>[\s\S]*?<yea-total>(\d+)<\/yea-total>[\s\S]*?<nay-total>(\d+)<\/nay-total>/
    );
    const [yea, nay] = totals ? [totals[1], totals[2]] : ["", ""];

    const votes = {};
    const re = /<legislator name-id="([A-Z]\d+)"[^>]*state="NY"[^>]*>[^<]*<\/legislator>\s*<vote>([^<]+)<\/vote>/g;
    for (const m of xml.matchAll(re)) votes[m[1]] = mapVote(m[2]);
    if (!Object.keys(votes).length) continue; // not a recorded member vote

    const bill = legisNum ? formatBillNumber(legisNum) : question;
    rollCalls.push({
      id: `house-${YEAR}-${roll}`,
      bill,
      title: desc || question,
      kind: PROCEDURAL.test(question) ? "procedural" : "substantive",
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
    sessionRollCallTotal: latest,
    memberKeys,
    rollCalls,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot, null, 2));
  console.log(`\nWrote ${rollCalls.length} roll calls, ${Object.keys(memberKeys).length} NY seats -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
