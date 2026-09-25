/**
 * Voter-guide types. One JSON file per race lives in content/guide/races/.
 * Every factual claim carries `sources` — ids into the race's `sources` list.
 * See content/guide/README.md for the research standard.
 */

export type SourceKind = "official" | "candidate" | "news" | "reference";

export interface GuideSource {
  /** Unique within the race file, e.g. "s1" */
  id: string;
  url: string;
  title: string;
  /** e.g. "Office of the Clerk, U.S. House" / "Ballotpedia" / "THE CITY" */
  publisher: string;
  /**
   * official  = government record (roll call, bill text, BOE, FEC, court)
   * candidate = the candidate's own site, press release, or verbatim interview
   * news      = independent journalism
   * reference = Ballotpedia, Wikipedia, voter guides
   */
  kind: SourceKind;
  /** ISO publication date when known */
  date?: string;
}

export interface Cited {
  text: string;
  sources: string[];
}

export const ISSUES = {
  abortion: "Protect legal access to abortion",
  guns: "Stricter gun laws",
  immigration_enforcement: "Expand immigration enforcement and deportations",
  rent_regulation: "Stronger rent regulation and tenant protections",
  housing_supply: "Loosen zoning rules to build more housing",
  tax_wealthy: "Raise taxes on high earners or corporations",
  healthcare_public: "Expand public health coverage",
  climate: "Faster transition away from fossil fuels",
  police_funding: "Increase police funding and staffing",
  school_choice: "Public funding for school choice (vouchers / charters)",
  congestion_pricing: "Keep congestion pricing in Manhattan",
  minimum_wage: "Raise the minimum wage",
  israel_aid: "Continue U.S. military aid to Israel",
  tariffs: "Broad tariffs on imported goods",
  universal_childcare: "Universal, publicly funded child care",
} as const;

export type IssueKey = keyof typeof ISSUES;
export type Stance = "supports" | "opposes" | "mixed";

export interface Position {
  issue: IssueKey;
  /** Relative to the ISSUES statement */
  stance: Stance;
  /** One neutral sentence describing the documented position */
  summary: string;
  /** Verbatim quote, if the source has one */
  quote?: string;
  sources: string[];
  /** "votes" when derived from recorded floor votes (set by the loader) */
  basis?: "votes" | "statements";
  /** When votes set the position, what the candidate has said on the same issue */
  stated?: { stance: Stance; summary: string; quote?: string; sources: string[] };
}

export interface RecordItem {
  /** Neutral description, e.g. "Voted yes on H.R. 1 (One Big Beautiful Bill Act), which passed 218–214." */
  text: string;
  date?: string;
  kind: "vote" | "bill" | "action" | "finance" | "legal";
  sources: string[];
}

export interface KeyVote {
  voteId: string;
  vote: "yes" | "no" | "present" | "not voting";
}

export interface StateVote {
  chamber: string;
  bill: string;
  title: string;
  summary?: string;
  outcome: string;
  date: string;
  vote: "yes" | "no" | "absent";
  sourceUrl: string;
}

export interface Finance {
  receipts: number;
  disbursements: number;
  cashOnHand: number;
  /** Coverage end date, ISO */
  asOf: string;
  sourceUrl: string;
  source: string;
}

export interface GuideCandidate {
  /** Unique within the race: slug of the name */
  id: string;
  name: string;
  /** Ballot lines: D, R, WFP, C, IND, LIB, G, or a verbatim line name */
  parties: string[];
  incumbent: boolean;
  /** e.g. "Won the June 23 Democratic primary" */
  ballotNote?: string;
  /** e.g. "U.S. Representative (since 2013)" */
  currentRole?: string;
  summary: Cited;
  background: Cited[];
  /** What the candidate says are their priorities (from their own materials) */
  priorities: Cited[];
  positions: Position[];
  /** Official actions: votes, sponsored bills, executive acts, court records */
  record: RecordItem[];
  website?: string;
  /** full = researched in depth; basic = a few sourced facts; minimal = little public record found */
  researchDepth: "full" | "basic" | "minimal";
  /** Filled by scripts: federal key votes (incumbents in Congress) */
  keyVotes?: KeyVote[];
  /** Filled by scripts: contested NY Senate/Assembly floor votes */
  stateVotes?: StateVote[];
  /** Filled by scripts: FEC totals */
  finance?: Finance;
  bioguideId?: string;
  fecId?: string;
}

export interface BallotMeasure {
  /** Question text as it appears on the ballot (or official summary) */
  question: Cited;
  summary: Cited;
  yesMeans: string;
  noMeans: string;
  argumentsFor: Cited[];
  argumentsAgainst: Cited[];
}

export type OfficeType =
  | "us-senate"
  | "us-house"
  | "governor"
  | "attorney-general"
  | "comptroller"
  | "state-senate"
  | "state-assembly"
  | "ballot-measure"
  | "other";

export interface GuideRace {
  id: string;
  /** Two-letter postal code */
  state: string;
  officeType: OfficeType;
  /** e.g. "U.S. House" */
  office: string;
  /** "10", "AL" (at-large), or omitted for statewide */
  district?: string;
  /** e.g. "U.S. House · New York's 10th District" */
  title: string;
  /** Plain-language description of the geography */
  area: string;
  /** Any part of the district lies within New York City */
  inNYC: boolean;
  electionDate: string;
  context: Cited[];
  candidates: GuideCandidate[];
  measure?: BallotMeasure;
  sources: GuideSource[];
  researchedAt: string;
  /** Honest limitations of the research, shown to readers */
  researchNotes?: string;
}
