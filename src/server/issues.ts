import { classifyIssues, type IssueRecord } from "@/lib/issues";
import { getSnapshots, snapshotVotes } from "./live/snapshot";
import type { Official } from "./types";

export function getIssueRecords(officials?: Official[]) {
  const snapshots = getSnapshots();
  const localVotes = (officials ?? []).flatMap((official) =>
    snapshotVotes(official.id, official.districtKey).map((vote) => ({ official, vote }))
  );
  const records: IssueRecord[] = snapshots.flatMap((snapshot) => snapshot.rollCalls.map((roll) => ({
    id: `${snapshot.chamber}:${roll.id}`,
    bill: roll.bill,
    title: roll.title,
    summary: roll.summary,
    summarySource: roll.summarySource,
    chamber: snapshot.chamber,
    kind: roll.kind,
    outcome: roll.outcome,
    question: roll.question,
    date: roll.date,
    dateLabel: roll.dateLabel,
    sourceUrl: roll.sourceUrl,
    sourceLabel: snapshot.sourceLabel,
    topics: classifyIssues(roll.title, roll.summary, roll.question),
    representatives: localVotes.filter(({ vote }) => vote.id.endsWith(`--${roll.id}`) && vote.chamber === snapshot.chamber).map(({ official, vote }) => ({
      id: official.id, name: official.name, role: official.role, vote: vote.vote,
    })),
  }))).filter((record) => !officials || record.representatives.length > 0).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return {
    records,
    coverage: snapshots.map((snapshot) => ({ chamber: snapshot.chamber, count: snapshot.rollCalls.length, updated: snapshot.generatedAt.slice(0, 10) })),
  };
}
