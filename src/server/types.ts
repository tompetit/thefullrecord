/**
 * Domain types for The Full Record.
 *
 * These shapes are the contract between the UI and any data source
 * (see datasource.ts). The in-memory data snapshot and a future real
 * data source both conform to them.
 */

export type VoteChoice = "yes" | "no" | "absent";
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
  /** e.g. "Council Member · District 33" */
  role: string;
  party: Party;
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
  id: string;
  officialId: string;
  /** Route id of the bill detail page, when we have one */
  billId?: string;
  /** e.g. "S4821-A" */
  billNumber: string;
  /** e.g. "SENATE" */
  chamber: string;
  title: string;
  /** AI-generated plain-English summary. Absent for bare procedural motions. */
  aiSummary?: string;
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

export interface BillStatusStep {
  label: string;
  dateLabel: string;
  state: "done" | "current" | "future";
}

export interface RollCallMember {
  name: string;
  /** e.g. "D–21" */
  district: string;
  vote: VoteChoice;
}

export interface RollCall {
  outcome: string;
  dateLabel: string;
  yes: number;
  no: number;
  absent: number;
  members: RollCallMember[];
  totalMembers: number;
  sourceUrl: string;
}

export interface BillSource {
  label: string;
  url: string;
}

export interface Bill {
  id: string;
  number: string;
  chamber: string;
  session: string;
  title: string;
  /** e.g. "Sponsor: Sen. Dana Okafor (D–SD 21) · 14 co-sponsors" */
  sponsorLine: string;
  whatItDoes: string;
  whoItAffects: string;
  statusSteps: BillStatusStep[];
  rollCall: RollCall;
  /** Note under "How your reps voted", incl. companion bill */
  yourRepsNote: string;
  /** Explicit recorded votes by the user's own representatives */
  yourRepsVotes: Array<{ officialId: string; vote: VoteChoice }>;
  sources: BillSource[];
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

export interface IssueReport {
  /** What the report is about: a vote summary, a said-vs-did pair, a bill summary… */
  subjectType: "vote" | "bill" | "said_vs_did" | "other";
  subjectId: string;
  message: string;
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

export interface SiteStats {
  trustLine: string;
  provenanceLine: string;
}
