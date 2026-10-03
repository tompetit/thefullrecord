/**
 * Domain types for The Full Record.
 *
 * These shapes are the contract between the UI and any data source
 * (see datasource.ts). The in-memory data snapshot and a future real
 * data source both conform to them.
 */

export type VoteChoice = "yes" | "no" | "absent" | "present";
export type VoteKind = "substantive" | "procedural";
export type Party = "D" | "R" | "WFP";
export type GovernmentLevel = "city" | "state" | "federal";
export type RelationshipLabel = "consistent" | "in_tension" | "not_directly_related";

export interface OfficialStats {
  /** null = not yet available from the source — the UI omits the stat */
  votesThisSession: number | null;
  rollCallsAttendedPct: number | null;
  billsSponsored: number | null;
}

export interface StatementStats {
  statementVotePairs: number;
  topicsCovered: number;
  statementsOnFile: number;
}

export interface Official {
  id: string;
  name: string;
  /**
   * Canonical seat key tying an official to a geocoded district:
   * "nyc-council-33" | "ny-ad-52" | "ny-sd-26" | "us-house-{st}-{n|al}" |
   * "us-sen-{st}-<1|2>" | "{st}-{upper|lower|legislature}-{openStatesUuid}"
   */
  districtKey: string;
  /** e.g. "Council Member · District 33" */
  role: string;
  /** null when the roster source doesn't state it — never guessed */
  party: Party | null;
  /** Party as the source states it when `party` has no code for it (e.g. "Independent"); shown neutrally */
  partyLabel?: string;
  level: GovernmentLevel;
  /** Group heading, e.g. "CITY — NYC COUNCIL" */
  levelLabel: string;
  /** e.g. "In office since 2021" */
  tenure: string;
  /** Extra locality shown after the role, e.g. "Brooklyn" */
  locality?: string;
  committees: string[];
  contactUrl: string;
  stats: OfficialStats;
  statementStats?: StatementStats;
  /** One-line latest-activity teaser for the representatives list */
  teaser: { text: string; vote?: VoteChoice };
  /** Provenance note under the stat table */
  methodologyNote: string;
}

export interface VoteRecord {
  /** Exact motion/question: a vote on a bill is not necessarily passage. */
  question?: string;
  id: string;
  officialId: string;
  /** e.g. "S4821-A" */
  billNumber: string;
  /** e.g. "SENATE" */
  chamber: string;
  title: string;
  /** Plain-English summary. Absent for bare procedural motions. */
  aiSummary?: string;
  /**
   * Provenance of the summary — "ai" (model-written, gets the AI marker)
   * or "official" (CRS / LRS text, gets the official-summary marker).
   */
  summarySource?: "ai" | "official";
  vote: VoteChoice;
  kind: VoteKind;
  /** e.g. "Passed Senate 42–18" */
  outcome: string;
  /** ISO date for sorting */
  date: string;
  /** e.g. "Jun 12, 2026" */
  dateLabel: string;
  sourceUrl: string;
  /** e.g. "Roll call · NY Senate" */
  sourceLabel: string;
}

export interface Sponsorship {
  id: string;
  officialId: string;
  billNumber: string;
  chamber: string;
  title: string;
  aiSummary?: string;
  /** "Sponsor" | "Co-sponsor" */
  sponsorRole: string;
  status: string;
  dateLabel: string;
  sourceUrl: string;
}

export interface AttendanceEntry {
  id: string;
  officialId: string;
  /** e.g. "June 2026" */
  period: string;
  attended: number;
  total: number;
  sourceUrl: string;
}

export interface Evidence {
  /** Direct quote (said) or neutral sentence (did) */
  text: string;
  /** e.g. "Campaign site" / "Senate roll call" */
  sourceName: string;
  dateLabel: string;
  sourceUrl: string;
}

export interface SaidDidPair {
  id: string;
  officialId: string;
  topic: string;
  label: RelationshipLabel;
  /** Eyebrow date shown collapsed, e.g. "OCT 2024" */
  saidEyebrowDate: string;
  didEyebrowDate: string;
  said: Evidence;
  did: Evidence & { vote: VoteChoice; billNumber: string };
  /** Neutral "why this label" note. Never a verdict. */
  whyNote?: string;
}

export interface DigestItem {
  officialId: string;
  officialName: string;
  chamber: string;
  billNumber: string;
  vote: VoteChoice;
  summary: string;
  outcome: string;
  dateLabel: string;
  sourceUrl: string;
}

export interface Digest {
  dateRangeLabel: string;
  items: DigestItem[];
  /** e.g. "Your other 3 representatives had no recorded votes this week." */
  quietLine: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OfficialGroup {
  level: GovernmentLevel;
  label: string;
  officials: Official[];
}

/** Honest context for an address lookup: gaps and caveats, never filled in by guessing. */
export interface LookupContext {
  /** Upper-case postal abbreviation of the matched address */
  state: string;
  /** Where the officeholder districts came from; the fallback may be the 2026 map */
  geographySource: "tigerweb-2024" | "census-2026-fallback";
  /** Set when the Nov 2026 U.S. House district differs from today's district */
  houseDistrictChange?: { ballotSeat: string; ballotLabel: string; currentLabel: string };
  /** Seats that matched nobody in the roster (vacancies), as display lines */
  gaps: string[];
  /** Other coverage caveats for this address */
  notes: string[];
}

export interface SiteStats {
  trustLine: string;
  provenanceLine: string;
}

export interface ElectionCandidate {
  name: string;
  /** Ballot-line labels as listed by the source (D, R, C, WFP…) */
  parties: string[];
  /** Holds THIS seat now */
  incumbent: boolean;
  /** Neutral, verifiable note (e.g. "pending certification") */
  note?: string;
}

export interface SeatElection {
  districtKey: string;
  electionName: string;
  /** ISO date of the election */
  electionDate: string;
  dateLabel: string;
  candidates: ElectionCandidate[];
  /** Ran in the primary for this seat and was not nominated */
  primaryNotNominated?: ElectionCandidate[];
  sourceUrl: string;
  sourceLabel: string;
}

/** A seat with no upcoming tracked election — states when it's next on the ballot. */
export interface SeatNotOnBallot {
  districtKey: string;
  nextElectionLabel: string;
}
