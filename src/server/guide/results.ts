import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Written by scripts/guide/results.mjs. Unofficial until states certify. */
export interface RaceResult {
  /** projected: a winner or outcome is called. Otherwise counting, ranked-choice tabulation or a runoff remains. */
  status: "projected" | "uncalled" | "runoff";
  /** Candidate id, for candidate races. */
  winner?: string;
  /** For ballot measures. */
  outcome?: "approved" | "rejected";
  /** Estimated share of the vote counted. */
  percentIn: number | null;
  candidates: Array<{ id?: string; name: string; votes: number | null; pct: number | null }>;
  /** We have no second source, as opposed to the count being unsettled. */
  unconfirmed?: boolean;
  note?: string;
  sources: Array<{ label: string; url: string }>;
}

interface ResultsFile {
  updatedAt: string;
  results: Record<string, RaceResult>;
}

let file: ResultsFile | null = null;
const load = () => (file ??= JSON.parse(readFileSync(join(process.cwd(), "content/guide/results.json"), "utf8")) as ResultsFile);

export const getRaceResult = (raceId: string): RaceResult | null => load().results[raceId] ?? null;
export const resultsUpdatedAt = () => load().updatedAt;
