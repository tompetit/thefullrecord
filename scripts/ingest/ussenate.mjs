/**
 * One-off ingest: U.S. Senate roll calls (119th Congress, 2nd session)
 * from senate.gov's official vote-menu + per-vote XML — keyless.
 *
 * Writes src/server/snapshot/ussenate.json with both NY senators'
 * positions on the most recent recorded votes, keyed by bioguide id
 * (memberKeys maps "sen-1" = senior, "sen-2" = junior).
 *
 * Run: node scripts/ingest/ussenate.mjs [--count 150]
 */

import { decodeXml, federalVote, positiveCount, writeSnapshot } from "./shared.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot/ussenate.json");
const CONGRESS = 119;
const SESSION = 2;
const COUNT = positiveCount(process.argv.slice(2), "--count", 150);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { "User-Agent": "thefullrecord-ingest/1.0 (civic transparency)" },
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

const tag = (xml, name) =>
  decodeXml(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "");

const PROCEDURAL = /motion to proceed|cloture|motion to table|motion to waive|motion to discharge|motion to commit|motion to recommit|quorum|motion to instruct|point of order|motion to adjourn/i;

const MONTHS = { January: "01", February: "02", March: "03", April: "04", May: "05", June: "06", July: "07", August: "08", September: "09", October: "10", November: "11", December: "12" };

/** "June 24, 2026, 05:31 PM" -> ["2026-06-24", "Jun 24, 2026"] */
function parseVoteDate(s) {
  const m = s.match(/([A-Za-z]+) (\d+), (\d{4})/);
  if (!m) return [null, s];
  const [, month, d, y] = m;
  return [`${y}-${MONTHS[month]}-${d.padStart(2, "0")}`, `${month.slice(0, 3)} ${Number(d)}, ${y}`];
}

const mapVote = federalVote;

async function main() {
  // NY senators: lis id -> bioguide, seniority order from congress-legislators.
  const legislators = JSON.parse(
    await fetchText("https://unitedstates.github.io/congress-legislators/legislators-current.json")
  );
  const nySenators = legislators
    .filter((l) => {
      const t = l.terms[l.terms.length - 1];
      return t.state === "NY" && t.type === "sen";
    })
    .map((l) => ({
      bioguide: l.id.bioguide,
      lis: l.id.lis,
      name: l.name.official_full,
      firstSenTerm: l.terms.find((t) => t.type === "sen")?.end ?? "",
    }))
    .sort((a, b) => a.firstSenTerm.localeCompare(b.firstSenTerm));
  const lisToBioguide = Object.fromEntries(nySenators.map((s) => [s.lis, s.bioguide]));
  const memberKeys = Object.fromEntries(nySenators.map((s, i) => [`sen-${i + 1}`, s.bioguide]));
  console.log("NY senators:", nySenators.map((s) => `${s.name} (${s.bioguide})`).join(", "));

  const menuXml = await fetchText(
    `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${CONGRESS}_${SESSION}.xml`
  );
  const menuVotes = [...menuXml.matchAll(/<vote>([\s\S]*?)<\/vote>/g)].map(([, v]) => ({
    number: tag(v, "vote_number"),
    date: tag(v, "vote_date"),
    issue: tag(v, "issue").replace(/&#160;|&nbsp;/g, " ").trim(),
    question: tag(v, "question"),
    result: tag(v, "result"),
    yeas: tag(v, "yeas"),
    nays: tag(v, "nays"),
    title: tag(v, "title"),
  }));
  if (!menuVotes.length) throw new Error("Senate menu contains no votes; keeping previous snapshot");
  const latest = Math.max(...menuVotes.map((v) => Number(v.number)));
  const recent = menuVotes
    .sort((a, b) => Number(b.number) - Number(a.number))
    .slice(0, COUNT);
  console.log(`Latest Senate vote: ${latest}. Ingesting ${recent.length}…`);

  const rollCalls = [];
  for (const mv of recent) {
    const num = mv.number.padStart(5, "0");
    const xml = await fetchText(
      `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${CONGRESS}${SESSION}/vote_${CONGRESS}_${SESSION}_${num}.xml`
    );
    await sleep(200);

    const votes = {};
    const rawVotes = {};
    for (const m of xml.matchAll(/<member>([\s\S]*?)<\/member>/g)) {
      const block = m[1];
      if (tag(block, "state") !== "NY") continue;
      const bioguide = lisToBioguide[tag(block, "lis_member_id")];
      if (bioguide) {
        rawVotes[bioguide] = tag(block, "vote_cast");
        votes[bioguide] = mapVote(rawVotes[bioguide]);
      }
    }
    if (!Object.keys(votes).length) continue;

    // The menu only carries "24-Jun"; the per-vote XML has the full date.
    const [date, dateLabel] = parseVoteDate(tag(xml, "vote_date"));
    if (!date) {
      console.warn(`  vote ${mv.number}: unparseable date, skipping`);
      continue;
    }
    const question = mv.question || tag(xml, "question");
    rollCalls.push({
      id: `ussenate-${CONGRESS}-${SESSION}-${Number(mv.number)}`,
      bill: mv.issue || question,
      title: mv.title || question,
      question,
      kind: PROCEDURAL.test(`${question} ${mv.title}`) ? "procedural" : "substantive",
      outcome: `${mv.result} ${mv.yeas}–${mv.nays}`,
      date,
      dateLabel,
      sourceUrl: `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${CONGRESS}${SESSION}/vote_${CONGRESS}_${SESSION}_${num}.htm`,
      votes,
      rawVotes,
    });
    console.log(`  vote ${mv.number}: ${mv.issue} — ${mv.result} ${mv.yeas}–${mv.nays}`);
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    chamber: "U.S. SENATE",
    sourceLabel: "Roll call · U.S. Senate",
    sessionRollCallTotal: latest,
    memberKeys,
    rollCalls,
  };
  await writeSnapshot(OUT, snapshot);
  console.log(`\nWrote ${rollCalls.length} roll calls -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
