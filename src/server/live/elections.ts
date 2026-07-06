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

/** Term facts for seats without a 2026 race. */
const NEXT_ON_BALLOT: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^nyc-council-\d+$/, label: "2029" },
  { pattern: /^us-sen-ny-1$/, label: "2028" }, // Schumer's seat (Class 3)
  { pattern: /^us-sen-ny-2$/, label: "2030" }, // Gillibrand's seat (Class 1)
];

export function electionForSeat(
  districtKey: string
): SeatElection | SeatNotOnBallot | null {
  const election = getElections().get(districtKey);
  if (election) return election;
  const next = NEXT_ON_BALLOT.find((n) => n.pattern.test(districtKey));
  if (next)
    return { districtKey, nextElectionLabel: next.label } satisfies SeatNotOnBallot;
  return null;
}
