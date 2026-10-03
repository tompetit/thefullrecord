/**
 * Election-slate loader.
 *
 * Candidate research is snapshotted into src/server/snapshot/candidates-*.json
 * (same one-off ingest pattern as votes). Each file covers a set of seats for
 * one election. Seats that are NOT on the 2026 ballot (NYC Council, both NY
 * U.S. Senate seats) get an honest "next on the ballot" note instead.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getRace } from "../guide/load";
import type { GuideRace } from "../guide/types";
import { getCongressRoster } from "./rosters";
import type { ElectionCandidate, SeatElection, SeatNotOnBallot } from "../types";

interface CandidatesFile {
  generatedAt: string;
  election: { name: string; date: string; dateLabel: string };
  seats: Array<{
    districtKey: string;
    candidates: ElectionCandidate[];
    primaryNotNominated?: ElectionCandidate[];
    sourceUrl: string;
    sourceLabel: string;
  }>;
}

const SNAPSHOT_DIR = join(process.cwd(), "src/server/snapshot");

let loaded: Map<string, SeatElection> | null = null;

function getElections(): Map<string, SeatElection> {
  if (loaded) return loaded;
  const map = new Map<string, SeatElection>();
  let files: string[] = [];
  try {
    files = readdirSync(SNAPSHOT_DIR).filter(
      (f) => f.startsWith("candidates-") && f.endsWith(".json")
    );
  } catch {
    // no snapshots yet
  }
  for (const file of files) {
    try {
      const parsed = JSON.parse(
        readFileSync(join(SNAPSHOT_DIR, file), "utf8")
      ) as CandidatesFile;
      for (const seat of parsed.seats) {
        map.set(seat.districtKey, {
          districtKey: seat.districtKey,
          electionName: parsed.election.name,
          electionDate: parsed.election.date,
          dateLabel: parsed.election.dateLabel,
          candidates: seat.candidates,
          primaryNotNominated: seat.primaryNotNominated,
          sourceUrl: seat.sourceUrl,
          sourceLabel: seat.sourceLabel,
        });
      }
    } catch (err) {
      console.error(`[elections] failed to load ${file}:`, err);
    }
  }
  loaded = map;
  return map;
}

/** NYC Council seats are not on the 2026 ballot (next regular election: 2029). */
const NYC_COUNCIL_NEXT = "2029";

const lastName = (name: string) =>
  name.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?$/i, "").trim().split(/\s+/).pop() ?? "";

/** An incumbent candidate in a race is the given member: bioguide id when the guide has one, else surname. */
function isIncumbentMember(
  race: GuideRace,
  member: { bioguide: string; name: string }
): boolean {
  return race.candidates.some(
    (c) =>
      c.bioguideId === member.bioguide ||
      (c.incumbent && !c.bioguideId && lastName(c.name) === lastName(member.name))
  );
}

function raceElection(districtKey: string, race: GuideRace): SeatElection {
  const slate = race.sources.find((s) => /ballotpedia/i.test(s.publisher)) ?? race.sources[0];
  return {
    districtKey,
    electionName: "2026 general election",
    electionDate: race.electionDate,
    dateLabel: "Nov 3, 2026",
    candidates: race.candidates.map((c) => ({
      name: c.name,
      parties: c.parties,
      incumbent: c.incumbent,
      note: c.ballotNote,
    })),
    sourceUrl: slate?.url ?? `/guide/race/${race.id}`,
    sourceLabel: slate?.publisher ?? "The Full Record voter guide",
  };
}

/**
 * Senate seats: find the race whose incumbent is this senator (regular or
 * special); otherwise use the term end to say when the seat is next up. A
 * term ending Jan 3 of year Y was won in the November of Y-1.
 */
async function senateElection(
  districtKey: string,
  st: string,
  index: number
): Promise<SeatElection | SeatNotOnBallot | null> {
  const senator = (await getCongressRoster()).senators.get(st)?.[index];
  if (!senator) return null;
  for (const id of [`us-sen-${st}`, `us-sen-${st}-special`]) {
    const race = getRace(id);
    if (race?.candidates.length && isIncumbentMember(race, senator))
      return raceElection(districtKey, race);
  }
  const year = Number(senator.termEnd.slice(0, 4)) - 1;
  // A seat up in 2026 with no matching incumbent may be open or unresearched; make no claim.
  if (!Number.isFinite(year) || year <= 2026) return null;
  return { districtKey, nextElectionLabel: String(year) };
}

export async function electionForSeat(
  districtKey: string
): Promise<SeatElection | SeatNotOnBallot | null> {
  const sen = districtKey.match(/^us-sen-([a-z]{2})-([12])$/);
  if (sen) return senateElection(districtKey, sen[1], Number(sen[2]) - 1);

  // Prefer the voter guide's researched slate (newer, re-verified) when present
  const race = getRace(districtKey);
  if (race && race.candidates.length) {
    const house = districtKey.match(/^us-house-([a-z]{2})-(\d+|al)$/);
    if (house && house[1] !== "ny") {
      // The 2026 map can differ from the one today's member was elected under,
      // so the same-numbered race is only this seat's when its incumbent is this member.
      const member = (await getCongressRoster()).house.get(`${house[1]}-${house[2]}`);
      if (!member || !isIncumbentMember(race, member)) return null;
    }
    return raceElection(districtKey, race);
  }
  const election = getElections().get(districtKey);
  if (election) return election;
  if (/^nyc-council-\d+$/.test(districtKey))
    return { districtKey, nextElectionLabel: NYC_COUNCIL_NEXT } satisfies SeatNotOnBallot;
  return null;
}
