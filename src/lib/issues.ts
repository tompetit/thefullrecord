import { stateName } from "./usStates";
import type { SplitKind } from "./divisive";

/** Topic tags are discovery aids, not judgments about a vote's policy direction. */
export const ISSUE_TOPICS = [
  { id: "housing", label: "Housing & rent", description: "Homes, tenants, development", terms: ["housing", "rent", "rental housing", "rental assistance", "rental property", "rental units", "rental agreements", "rental residential", "rental home", "rental supplement", "tenant", "tenants", "dwelling", "dwellings", "homeless", "homelessness", "landlord", "landlords", "mortgage"] },
  { id: "health", label: "Health & care", description: "Care, coverage, public health", terms: ["health", "healthcare", "medical", "medicaid", "medicare", "hospital", "hospitals", "patient", "patients", "reproductive", "abortion", "nursing", "mental health"] },
  { id: "education", label: "Education & families", description: "Schools, students, child care", terms: ["education", "school", "schools", "student", "students", "tuition", "college", "child care", "childcare", "children", "child"] },
  { id: "economy", label: "Jobs & cost of living", description: "Work, taxes, consumer costs", terms: ["labor", "labour", "worker", "workers", "employment", "wage", "wages", "union", "tax", "taxes", "taxation", "budget", "debt", "consumer", "consumers", "appropriations", "affordability"] },
  { id: "climate", label: "Climate & energy", description: "Energy, emissions, environment", terms: ["climate", "energy", "emissions", "environment", "environmental", "renewable", "pollution", "fossil", "electricity", "solar", "flood", "flooding", "conservation"] },
  { id: "transport", label: "Transportation", description: "Transit, streets, getting around", terms: ["transportation", "transit", "subway", "bus", "buses", "rail", "railroad", "pedestrian", "bicycle", "bicycles", "traffic", "road", "roads", "highway", "highways", "parking"] },
  { id: "rights", label: "Rights & public safety", description: "Justice, rights, accountability", terms: ["rights", "police", "criminal", "crime", "prison", "incarceration", "firearm", "firearms", "gun", "guns", "immigration", "immigrant", "immigrants", "discrimination", "harassment", "ethics", "election", "elections", "voting"] },
  { id: "technology", label: "Technology & privacy", description: "AI, personal data, online life", terms: ["artificial intelligence", "ai", "chatbot", "chatbots", "deepfake", "deepfakes", "privacy", "data", "cybersecurity", "internet", "digital", "social media", "synthetic"] },
  { id: "foreign", label: "Foreign affairs & defense", description: "Military action, diplomacy, trade", terms: ["war", "military", "armed forces", "hostilities", "iran", "israel", "ukraine", "defense", "defence", "foreign", "sanctions", "tariff", "tariffs", "nato"] },
] as const;

/** Accept only known, unique topic ids from shareable comma-separated URLs. */
export function parseIssueTopics(value: string): string[] {
  const allowed = new Set<string>([...ISSUE_TOPICS.map((topic) => topic.id), "other"]);
  return [...new Set(value.split(",").filter((topic) => allowed.has(topic)))];
}

export function classifyIssues(title: string, summary = "", question = ""): string[] {
  const text = ` ${title} ${summary} ${question} `.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return ISSUE_TOPICS.filter((topic) => topic.terms.some((term) => text.includes(` ${term} `))).map((topic) => topic.id);
}

export interface IssueRecord {
  id: string;
  bill: string;
  title: string;
  summary?: string;
  summarySource?: "ai" | "official";
  /** AI-written one-line explanation of what a yes vote did (procedural/amendment votes) */
  meaning?: string;
  chamber: string;
  kind: "substantive" | "procedural";
  outcome: string;
  /** At least one member voted on each side (not unanimous). */
  split: boolean;
  splitKind: SplitKind;
  /** Split vote decided by a narrow margin. */
  close: boolean;
  /** Democratic / Republican [yes, no] counts, when known. */
  parties?: { D?: [number, number]; R?: [number, number] };
  question?: string;
  date: string;
  dateLabel: string;
  sourceUrl: string;
  sourceLabel: string;
  topics: string[];
  representatives: Array<{ id: string; name: string; role: string; vote: "yes" | "no" | "absent" | "present"; broke?: boolean }>;
}

export const SHOW_OPTIONS = [
  { value: "split", label: "Split votes" },
  { value: "party-line", label: "Party-line votes" },
  { value: "crossed", label: "Votes that crossed party lines" },
  { value: "close", label: "Close votes" },
  { value: "all", label: "All votes, including unanimous" },
] as const;
export const LOCAL_SHOW = { value: "reps-split", label: "Where your representatives split" };
export const SPLIT_LABELS: Partial<Record<SplitKind, string>> = { unanimous: "Unanimous", "party-line": "Party-line", crossed: "Crossed party lines", bipartisan: "Bipartisan" };

export interface IssueFilters {
  topics: string[];
  query: string;
  chamber: string;
  kind: string;
  /** One of SHOW_OPTIONS / LOCAL_SHOW values; "" is the default (split votes). */
  show: string;
}

/** Local representatives voted both yes and no on this vote. */
export const repsSplit = (record: IssueRecord) => record.representatives.some((r) => r.vote === "yes") && record.representatives.some((r) => r.vote === "no");

/** "H.R. 1", "hr-1" and "HR1" all become "hr1". */
const normBill = (text: string) => text.toLowerCase().replace(/[\s.-]+/g, "");

/** Readable chamber name for a stored one like "CA ASSEMBLY" or "NY SENATE". */
export function chamberLabel(raw: string): string {
  const fixed: Record<string, string> = { "U.S. HOUSE": "U.S. House", "U.S. SENATE": "U.S. Senate", "NYC COUNCIL": "NYC Council", "DC COUNCIL": "D.C. Council" };
  if (fixed[raw]) return fixed[raw];
  const [st, ...rest] = raw.split(" ");
  const body = rest.join(" ").toLowerCase().replace(/\b(?!of\b)./g, (c) => c.toUpperCase());
  return `${stateName(st)} ${body}`;
}

/** U.S. chambers, then New York, D.C., then other states by name. */
export function chamberOptions(raws: Iterable<string>): Array<{ value: string; label: string }> {
  const order = ["U.S. HOUSE", "U.S. SENATE", "NY SENATE", "NY ASSEMBLY", "NYC COUNCIL", "DC COUNCIL"];
  const rank = (raw: string) => (order.includes(raw) ? order.indexOf(raw) : order.length);
  return [...new Set(raws)].map((value) => ({ value, label: chamberLabel(value) })).sort((a, b) => rank(a.value) - rank(b.value) || a.label.localeCompare(b.label));
}

export function filterIssueRecords(records: IssueRecord[], filters: IssueFilters): IssueRecord[] {
  const query = filters.query.trim().toLowerCase();
  const bill = normBill(query);
  const billSearch = /^[a-z]+\d+[a-z]?$/.test(bill) && records.some((record) => normBill(record.bill) === bill);
  // Typing a search looks across every vote, unanimous ones included.
  const show = query && (!filters.show || filters.show === "split") ? "all" : filters.show || "split";
  return records.filter((record) =>
    (!filters.topics.length || filters.topics.some((topic) => topic === "other" ? !record.topics.length : record.topics.includes(topic))) &&
    (!filters.chamber || record.chamber === filters.chamber) &&
    (!filters.kind || record.kind === filters.kind) &&
    (show === "all" || (show === "split" ? record.split : show === "close" ? record.close : show === "reps-split" ? repsSplit(record) : record.splitKind === show)) &&
    (!query || (billSearch ? normBill(record.bill) === bill : `${record.bill} ${record.title} ${record.summary ?? ""} ${record.question ?? ""}`.toLowerCase().includes(query)))
  );
}
