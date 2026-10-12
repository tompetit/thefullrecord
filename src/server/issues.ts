import { brokeWithParty } from "@/lib/divisive";
import { classifyIssues, type IssueRecord } from "@/lib/issues";
import { getSnapshots, memberKeyFor, partyFor, rollCallSplit } from "./live/snapshot";
import type { Official } from "./types";

let allRecords: IssueRecord[] | null = null;

/** Every roll call as an IssueRecord, newest first. Built once per server process. */
function baseRecords(): IssueRecord[] {
  if (allRecords) return allRecords;
  allRecords = getSnapshots().flatMap((snapshot) => snapshot.rollCalls.map((roll) => {
    const split = rollCallSplit(snapshot, roll);
    const { D, R } = split.byParty;
    return {
      id: `${snapshot.chamber}:${roll.id}`,
      bill: roll.bill,
      title: roll.title,
      summary: roll.summary,
      summarySource: roll.summarySource,
      chamber: snapshot.chamber,
      kind: roll.kind,
      outcome: roll.outcome,
      split: split.kind !== "unanimous",
      splitKind: split.kind,
      close: split.close,
      parties: D || R ? { D: D && [D.yes, D.no], R: R && [R.yes, R.no] } : undefined,
      question: roll.question,
      date: roll.date,
      dateLabel: roll.dateLabel,
      sourceUrl: roll.sourceUrl,
      sourceLabel: snapshot.sourceLabel,
      topics: classifyIssues(roll.title, roll.summary, roll.question),
      representatives: [],
    } satisfies IssueRecord;
  })).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return allRecords;
}

/** All records, or with officials only those where at least one of them has a position. */
export function getIssueRecords(officials?: Official[]) {
  const base = baseRecords();
  if (!officials) return { records: base };
  const reps = new Map<string, IssueRecord["representatives"]>();
  for (const snapshot of getSnapshots()) {
    const members = officials.flatMap((official) => {
      const key = memberKeyFor(snapshot, official.districtKey);
      return key ? [{ official, key, party: partyFor(snapshot, key) }] : [];
    });
    if (!members.length) continue;
    for (const roll of snapshot.rollCalls) {
      const split = rollCallSplit(snapshot, roll);
      for (const { official, key, party } of members) {
        const vote = roll.votes[key];
        if (!vote) continue;
        const id = `${snapshot.chamber}:${roll.id}`;
        const list = reps.get(id) ?? [];
        list.push({ id: official.id, name: official.name, role: official.role, vote, broke: brokeWithParty(vote, party, split) });
        reps.set(id, list);
      }
    }
  }
  return { records: base.filter((record) => reps.has(record.id)).map((record) => ({ ...record, representatives: reps.get(record.id)! })) };
}
