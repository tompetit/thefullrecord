/**
 * One-off ingest: U.S. Senate roll calls (119th Congress, 2nd session)
 * from senate.gov's official vote-menu + per-vote XML — keyless.
 *
 * Writes src/server/snapshot/ussenate.json with every senator's position
 * on the most recent recorded votes, keyed by bioguide id (memberKeys maps
 * "sen-{st}-1" = senior, "sen-{st}-2" = junior; seniority = earliest start
 * of Senate service).
 *
 * Default: every recorded vote of the 119th Congress (sessions 1 and 2).
 * Votes already in the snapshot are reused; pass --refetch to re-download.
 *
 * Run: node scripts/ingest/ussenate.mjs [--all | --session 2 [--session 1]] [--count N] [--refetch]
 *   --count N  only the N most recent votes of each selected session
 * Votes are stored compactly (see compactSnapshot in shared.mjs).
 */

import { readFile } from "node:fs/promises";
import { decodeXml, expandSnapshot, federalVote, politeGet, writeSnapshot } from "./shared.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "src/server/snapshot/ussenate.json");
const CONGRESS = 119;
const ARGS = process.argv.slice(2);
const argValues = (flag) => ARGS.flatMap((a, i) => (a === flag ? [ARGS[i + 1]] : []));
const SESSIONS = argValues("--session").length ? argValues("--session").map(Number) : [1, 2];
if (SESSIONS.some((n) => ![1, 2].includes(n))) throw new Error("--session must be 1 or 2");
const COUNT = argValues("--count")[0] === undefined ? Infinity : Number(argValues("--count")[0]);
if (!(COUNT >= 1)) throw new Error("--count must be a positive integer");
const REFETCH = ARGS.includes("--refetch");

async function fetchText(url) {
  return (await politeGet(url, { minGapMs: 200 })).text();
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
  // All senators: lis id -> bioguide, seniority order from congress-legislators.
  const legislators = JSON.parse(
    await fetchText("https://unitedstates.github.io/congress-legislators/legislators-current.json")
  );
  const senators = legislators
    .filter((l) => l.terms[l.terms.length - 1].type === "sen")
    .map((l) => ({
      bioguide: l.id.bioguide,
      lis: l.id.lis,
      name: l.name.official_full,
      state: l.terms[l.terms.length - 1].state.toLowerCase(),
      firstSenateStart: l.terms.find((t) => t.type === "sen")?.start ?? "",
    }))
    .sort((a, b) => a.firstSenateStart.localeCompare(b.firstSenateStart) || a.name.localeCompare(b.name));
  if (senators.length < 90) throw new Error("congress-legislators Senate roster looks incomplete; keeping previous snapshot");
  const lisToBioguide = Object.fromEntries(senators.map((s) => [s.lis, s.bioguide]));
  const memberKeys = {};
  const perState = {};
  for (const s of senators) {
    perState[s.state] = (perState[s.state] ?? 0) + 1;
    memberKeys[`sen-${s.state}-${perState[s.state]}`] = s.bioguide;
  }
  console.log(`${senators.length} senators from ${Object.keys(perState).length} states`);

  let previous = [];
  try { previous = expandSnapshot(JSON.parse(await readFile(OUT, "utf8"))).rollCalls; } catch { /* first run */ }
  const known = new Map(previous.map((rc) => [rc.id, rc]));
  // Sessions not selected this run keep their previously ingested votes.
  const rollCalls = previous.filter((rc) => !SESSIONS.includes(Number(rc.id.split("-")[2])));
  let latest = 0;

  for (const SESSION of SESSIONS) {
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
    if (!menuVotes.length) throw new Error(`Senate session ${SESSION} menu contains no votes; keeping previous snapshot`);
    latest += Math.max(...menuVotes.map((v) => Number(v.number)));
    const recent = menuVotes
      .sort((a, b) => Number(b.number) - Number(a.number))
      .slice(0, COUNT);
    console.log(`Session ${SESSION}: ${menuVotes.length} menu votes. Ingesting ${recent.length}…`);

    for (const mv of recent) {
      const id = `ussenate-${CONGRESS}-${SESSION}-${Number(mv.number)}`;
      if (!REFETCH && known.has(id)) { rollCalls.push(known.get(id)); continue; }
      const num = mv.number.padStart(5, "0");
      const xml = await fetchText(
        `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${CONGRESS}${SESSION}/vote_${CONGRESS}_${SESSION}_${num}.xml`
      );

      const votes = {};
      for (const m of xml.matchAll(/<member>([\s\S]*?)<\/member>/g)) {
        const block = m[1];
        const bioguide = lisToBioguide[tag(block, "lis_member_id")];
        if (bioguide) votes[bioguide] = mapVote(tag(block, "vote_cast"));
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
        id,
        bill: mv.issue || question,
        title: mv.title || question,
        question,
        kind: PROCEDURAL.test(`${question} ${mv.title}`) ? "procedural" : "substantive",
        outcome: `${mv.result} ${mv.yeas}–${mv.nays}`,
        date,
        dateLabel,
        sourceUrl: `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${CONGRESS}${SESSION}/vote_${CONGRESS}_${SESSION}_${num}.htm`,
        votes,
      });
      console.log(`  vote ${SESSION}-${mv.number}: ${mv.issue} — ${mv.result} ${mv.yeas}–${mv.nays}`);
    }
  }
  rollCalls.sort((a, b) => b.date.localeCompare(a.date) || Number(b.id.split("-")[3]) - Number(a.id.split("-")[3]));

  const snapshot = {
    generatedAt: new Date().toISOString(),
    chamber: "U.S. SENATE",
    sourceLabel: "Roll call · U.S. Senate",
    sessionRollCallTotal: latest,
    memberKeys,
    rollCalls,
  };
  await writeSnapshot(OUT, snapshot, { compact: true });
  console.log(`\nWrote ${rollCalls.length} roll calls -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
