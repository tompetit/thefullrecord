/**
 * "Where I stand" — a cited, issue-by-issue comparison between a voter's own
 * answers and a candidate's documented positions.
 *
 * Deliberately NOT a score: there is no percentage, no weighting, no ranking,
 * and candidates keep the order they were given (alphabetical by the caller).
 * Statements and recorded votes are compared separately: a documented stance is
 * compared with the voter's answer as a whole; each recorded vote is compared on
 * its own, using the editors' note of which way a Yes points (see load.ts), and
 * no overall stance is ever inferred from votes. Pure functions only — imported by server and client
 * components and by tests/alignment.test.mjs (type-only imports on purpose).
 */
import type { GuideRace, GuideSource, IssueKey, Position, RecordedVote, Stance } from "../server/guide/types";

export type Answer = "agree" | "disagree";
export interface StandEntry {
  issue: IssueKey;
  answer: Answer;
}

/** Outcome of a documented statement; "votes_only" = no statement, but recorded votes exist. */
export type Outcome = "same" | "different" | "mixed" | "votes_only" | "none";
export type VoteMatch = "in_line" | "not_in_line" | "not_compared";

export interface StatementEvidence {
  stance: Exclude<Stance, "not_inferred">;
  summary: string;
  quote?: string;
  sources: string[];
}

export interface VoteComparison extends RecordedVote {
  match: VoteMatch;
}

export interface AlignmentItem extends StandEntry {
  outcome: Outcome;
  statement?: StatementEvidence;
  votes: VoteComparison[];
}

export interface AlignmentCounts {
  answered: number;
  same: number;
  different: number;
  mixed: number;
  /** Topics with recorded votes but no documented statement */
  votesOnly: number;
  none: number;
  votesInLine: number;
  votesNotInLine: number;
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

/** Compare one voter answer with one documented stance (or its absence). */
export function compareIssue(stance: Stance | undefined, answer: Answer): Outcome {
  if (!stance || stance === "not_inferred") return "none";
  if (stance === "mixed") return "mixed";
  return (stance === "supports") === (answer === "agree") ? "same" : "different";
}

/** One recorded vote against one answer. A No vote is compared as a vote against the measure, nothing more. */
export function compareVote(v: RecordedVote, answer: Answer): VoteMatch {
  if (!v.yesMeans) return "not_compared";
  const votedWithStatement = (v.vote === "yes") === (v.yesMeans === "supports");
  return votedWithStatement === (answer === "agree") ? "in_line" : "not_in_line";
}

/** The candidate's own documented statement on a topic, wherever the loader put it. */
export function statementOf(position: Position | undefined): StatementEvidence | undefined {
  if (!position) return undefined;
  const s = position.basis === "votes" ? position.stated : position;
  if (!s || s.stance === "not_inferred") return undefined;
  return { stance: s.stance, summary: s.summary, quote: s.quote, sources: s.sources };
}

export function compareCandidate(
  positions: readonly Position[],
  stand: readonly StandEntry[],
): { items: AlignmentItem[]; counts: AlignmentCounts } {
  const items = stand.map((entry): AlignmentItem => {
    const position = positions.find((p) => p.issue === entry.issue);
    const statement = statementOf(position);
    const votes = (position?.basis === "votes" ? position.votes ?? [] : []).map((v) => ({ ...v, match: compareVote(v, entry.answer) }));
    const outcome = statement ? compareIssue(statement.stance, entry.answer) : votes.length ? "votes_only" : "none";
    return { ...entry, outcome, statement, votes };
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
  const counts: AlignmentCounts = { answered: items.length, same: 0, different: 0, mixed: 0, votesOnly: 0, none: 0, votesInLine: 0, votesNotInLine: 0 };
  for (const item of items) {
    if (item.outcome === "same") counts.same++;
    else if (item.outcome === "different") counts.different++;
    else if (item.outcome === "mixed") counts.mixed++;
    else if (item.outcome === "votes_only") counts.votesOnly++;
    else counts.none++;
    for (const v of item.votes) {
      if (v.match === "in_line") counts.votesInLine++;
      else if (v.match === "not_in_line") counts.votesNotInLine++;
    }
  }
  return counts;
}

/** Plain-fact tallies — never a percentage or a rating. Statements and votes are kept apart. */
export function countsSentence(c: AlignmentCounts): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const statements = `Statements: same as you on ${c.same}, different on ${c.different}${c.mixed ? `, mixed on ${c.mixed}` : ""}`;
  const votes = c.votesInLine + c.votesNotInLine
    ? ` · Recorded votes: ${n(c.votesInLine, "vote", "votes")} in line with your answers, ${c.votesNotInLine} not`
    : "";
  return `${statements}${votes} · No record on ${c.none} of the ${n(c.answered, "topic", "topics")} you answered`;
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
    for (const p of c.positions) for (const id of [...p.sources, ...(p.stated?.sources ?? []), ...(p.votes ?? []).flatMap((v) => v.sources)]) used.add(id);
  return {
    id: race.id,
    title: race.title,
    // Keep every entry in place so citation numbers match the race page's
    // source list; blank out the ones the comparison never cites.
    sources: race.sources.map((s) => (used.has(s.id) ? s : { ...s, title: "", publisher: "", url: "" })),
    candidates: alphabetical(race.candidates).map((c) => ({ id: c.id, name: c.name, parties: c.parties, positions: c.positions })),
  };
}
