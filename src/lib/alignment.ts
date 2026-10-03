/**
 * "Where I stand" — a cited, issue-by-issue comparison between a voter's own
 * answers and a candidate's documented positions.
 *
 * Deliberately NOT a score: there is no percentage, no weighting, no ranking,
 * and candidates keep the order they were given (alphabetical by the caller).
 * Vote-based evidence is never turned into a direction (see load.ts), so it is
 * shown but not counted. Pure functions only — imported by server and client
 * components and by tests/alignment.test.mjs (type-only imports on purpose).
 */
import type { GuideRace, GuideSource, IssueKey, Position } from "../server/guide/types";

export type Answer = "agree" | "disagree";
export interface StandEntry {
  issue: IssueKey;
  answer: Answer;
}

export type Outcome = "same" | "different" | "mixed" | "not_inferred" | "none";

export interface AlignmentItem extends StandEntry {
  outcome: Outcome;
  /** Undefined when the outcome is "none" */
  position?: Position;
  basis?: "votes" | "statements";
}

export interface AlignmentCounts {
  answered: number;
  same: number;
  different: number;
  mixed: number;
  notInferred: number;
  none: number;
}

/** Short topic labels, shared by the matcher and alignment views. */
export const TOPIC_LABELS: Record<IssueKey, string> = {
  abortion: "Abortion", guns: "Gun laws", immigration_enforcement: "Immigration",
  rent_regulation: "Rent & tenant protections", housing_supply: "Housing & zoning",
  tax_wealthy: "Taxes", healthcare_public: "Health coverage", climate: "Climate & energy",
  police_funding: "Policing", school_choice: "School choice", congestion_pricing: "Congestion pricing",
  minimum_wage: "Minimum wage", israel_aid: "U.S. aid to Israel", tariffs: "Trade & tariffs",
  universal_childcare: "Child care",
  voter_citizenship_proof: "Voter registration & citizenship",
  war_powers: "War powers",
  transgender_sports: "Transgender athletes",
};

const ANSWERS: readonly Answer[] = ["agree", "disagree"];
const MAX_PARAM_LENGTH = 1000;

/**
 * Parse `?stand=rent_regulation:agree,guns:disagree`. Unknown issues, unknown
 * answers ("skip" included), malformed pairs, and repeats (first one wins) are
 * dropped. Output follows the order of `allowed` (the canonical ISSUES order),
 * so the same answers always produce the same URL and the same display order.
 */
export function parseStand(
  raw: string | string[] | null | undefined,
  allowed: readonly IssueKey[],
): StandEntry[] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !value) return [];
  const picked = new Map<IssueKey, Answer>();
  const allowedSet = new Set<string>(allowed);
  for (const pair of value.slice(0, MAX_PARAM_LENGTH).split(",")) {
    const [key, answer, ...rest] = pair.trim().split(":");
    if (rest.length || !allowedSet.has(key) || !ANSWERS.includes(answer as Answer)) continue;
    if (!picked.has(key as IssueKey)) picked.set(key as IssueKey, answer as Answer);
  }
  return allowed.filter((k) => picked.has(k)).map((issue) => ({ issue, answer: picked.get(issue)! }));
}

export function serializeStand(stand: readonly StandEntry[]): string {
  return stand.map((s) => `${s.issue}:${s.answer}`).join(",");
}

/** Add (or drop, when empty) the `stand` query param on an internal href. */
export function withStand(href: string, standParam: string): string {
  const [pathAndQuery, hash = ""] = href.split("#");
  const [path, query = ""] = pathAndQuery.split("?");
  const params = new URLSearchParams(query);
  if (standParam) params.set("stand", standParam);
  else params.delete("stand");
  const qs = params.toString().replace(/%3A/gi, ":").replace(/%2C/gi, ",");
  return `${path}${qs ? `?${qs}` : ""}${hash ? `#${hash}` : ""}`;
}

/** Compare one voter answer with one documented position (or its absence). */
export function compareIssue(position: Position | undefined, answer: Answer): Outcome {
  if (!position) return "none";
  // Recorded votes alone never set a direction (load.ts forces not_inferred).
  if (position.basis === "votes" || position.stance === "not_inferred") return "not_inferred";
  if (position.stance === "mixed") return "mixed";
  const candidateAgrees = position.stance === "supports";
  return candidateAgrees === (answer === "agree") ? "same" : "different";
}

export function compareCandidate(
  positions: readonly Position[],
  stand: readonly StandEntry[],
): { items: AlignmentItem[]; counts: AlignmentCounts } {
  const items = stand.map((entry): AlignmentItem => {
    const position = positions.find((p) => p.issue === entry.issue);
    return {
      ...entry,
      outcome: compareIssue(position, entry.answer),
      position,
      basis: position ? (position.basis === "votes" ? "votes" : "statements") : undefined,
    };
  });
  return { items, counts: countOutcomes(items) };
}

/** Compare every candidate, preserving the caller's order exactly. */
export function compareCandidates<C extends { positions: Position[] }>(
  candidates: readonly C[],
  stand: readonly StandEntry[],
): Array<{ candidate: C; items: AlignmentItem[]; counts: AlignmentCounts }> {
  return candidates.map((candidate) => ({ candidate, ...compareCandidate(candidate.positions, stand) }));
}

export function countOutcomes(items: readonly AlignmentItem[]): AlignmentCounts {
  const counts: AlignmentCounts = { answered: items.length, same: 0, different: 0, mixed: 0, notInferred: 0, none: 0 };
  for (const item of items) {
    if (item.outcome === "same") counts.same++;
    else if (item.outcome === "different") counts.different++;
    else if (item.outcome === "mixed") counts.mixed++;
    else if (item.outcome === "not_inferred") counts.notInferred++;
    else counts.none++;
  }
  return counts;
}

/** Plain-fact tally — never a percentage or a rating. */
export function countsSentence(c: AlignmentCounts): string {
  const parts = [`Same on ${c.same}`, `Different on ${c.different}`, `Mixed ${c.mixed}`];
  if (c.notInferred) parts.push(`Votes only, not compared ${c.notInferred}`);
  parts.push(`No record ${c.none}`);
  return `${parts.join(" · ")} of the ${c.answered} ${c.answered === 1 ? "topic" : "topics"} you answered`;
}

export function alphabetical<C extends { name: string }>(candidates: readonly C[]): C[] {
  return [...candidates].sort((a, b) => a.name.localeCompare(b.name));
}

/** The slice of a race the comparison needs — small enough to send to the client. */
export interface AlignmentRace {
  id: string;
  title: string;
  sources: GuideSource[];
  candidates: Array<{ id: string; name: string; parties: string[]; positions: Position[] }>;
}

export function alignmentRace(race: GuideRace): AlignmentRace {
  const used = new Set<string>();
  for (const c of race.candidates)
    for (const p of c.positions) for (const id of [...p.sources, ...(p.stated?.sources ?? [])]) used.add(id);
  return {
    id: race.id,
    title: race.title,
    // Keep every entry in place so citation numbers match the race page's
    // source list; blank out the ones the comparison never cites.
    sources: race.sources.map((s) => (used.has(s.id) ? s : { ...s, title: "", publisher: "", url: "" })),
    candidates: alphabetical(race.candidates).map((c) => ({ id: c.id, name: c.name, parties: c.parties, positions: c.positions })),
  };
}
