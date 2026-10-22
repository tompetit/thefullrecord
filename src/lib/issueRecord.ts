/** Pure per-topic roll-up of a member's recorded votes (no I/O). Counts and examples only: no scores, no stance inferred. */
import { contention, majority, type PartySplit } from "./divisive";

export interface IssueVoteInput {
  vote: "yes" | "no";
  split: PartySplit;
  topics: string[];
  kind: "substantive" | "procedural";
  bill: string;
  example: IssueExample;
}

export interface IssueExample {
  id: string;
  href: string;
  title: string;
  summary?: string;
  date: string;
  dateLabel: string;
  sourceUrl: string;
  outcome: string;
  vote: "yes" | "no";
  /** Side most of the member's party took; absent when the party had no clear side */
  partySide?: "yes" | "no";
}

export interface IssueRow {
  topic: string;
  /** Divided (not unanimous) votes on bills tagged with this topic that the member cast yes or no */
  total: number;
  yes: number;
  no: number;
  withParty: number;
  againstParty: number;
  /** The most contested of these votes, one per bill */
  examples: IssueExample[];
}

/** Substantive, divided votes only; rows ordered by how many votes they hold. Null when fewer than `min` such votes are tagged. */
export function summarizeByIssue(party: string | undefined, inputs: IssueVoteInput[], maxExamples = 3, min = 5): IssueRow[] | null {
  const rows = new Map<string, IssueRow & { ranked: Array<{ score: number; bill: string; ex: IssueExample }> }>();
  let tagged = 0;
  for (const { vote, split, topics, kind, bill, example } of inputs) {
    if (kind !== "substantive" || !topics.length || split.yes === 0 || split.no === 0) continue;
    tagged++;
    const side = party === "D" || party === "R" ? majority(split.byParty[party]) : undefined;
    const ex = { ...example, vote, partySide: side };
    const score = contention(split, kind);
    for (const topic of topics) {
      let row = rows.get(topic);
      if (!row) rows.set(topic, (row = { topic, total: 0, yes: 0, no: 0, withParty: 0, againstParty: 0, examples: [], ranked: [] }));
      row.total++;
      row[vote]++;
      if (side) row[side === vote ? "withParty" : "againstParty"]++;
      row.ranked.push({ score, bill, ex });
    }
  }
  if (tagged < min) return null;
  return [...rows.values()]
    .sort((a, b) => b.total - a.total || a.topic.localeCompare(b.topic))
    .map(({ ranked, ...row }) => {
      const seen = new Set<string>();
      const examples = ranked
        .sort((a, b) => b.score - a.score || b.ex.date.localeCompare(a.ex.date))
        .filter(({ bill, ex }) => !seen.has(bill || ex.title) && Boolean(seen.add(bill || ex.title)))
        .slice(0, maxExamples)
        .map((x) => x.ex);
      return { ...row, examples };
    });
}
