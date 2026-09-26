/** Topic tags are discovery aids, not judgments about a vote's policy direction. */
export const ISSUE_TOPICS = [
  { id: "housing", label: "Housing & rent", description: "Homes, tenants, development", terms: ["housing", "rent", "rental", "tenant", "tenants", "dwelling", "dwellings", "homeless", "homelessness", "landlord", "landlords", "mortgage"] },
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
  chamber: string;
  kind: "substantive" | "procedural";
  outcome: string;
  question?: string;
  date: string;
  dateLabel: string;
  sourceUrl: string;
  sourceLabel: string;
  topics: string[];
  representatives: Array<{ id: string; name: string; role: string; vote: "yes" | "no" | "absent" | "present" }>;
}

export interface IssueFilters {
  topics: string[];
  query: string;
  chamber: string;
  kind: string;
}

export function filterIssueRecords(records: IssueRecord[], filters: IssueFilters): IssueRecord[] {
  const query = filters.query.trim().toLowerCase();
  return records.filter((record) =>
    (!filters.topics.length || filters.topics.some((topic) => topic === "other" ? !record.topics.length : record.topics.includes(topic))) &&
    (!filters.chamber || record.chamber === filters.chamber) &&
    (!filters.kind || record.kind === filters.kind) &&
    (!query || `${record.bill} ${record.title} ${record.summary ?? ""} ${record.question ?? ""}`.toLowerCase().includes(query))
  );
}
