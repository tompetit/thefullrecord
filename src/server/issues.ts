import { brokeWithParty, contention } from "@/lib/divisive";
import { chamberState, sortIssueRecords, type IssueRecord } from "@/lib/issues";
import { getSnapshots, memberKeyFor, partyFor, rollCallSplit, rollCallTopics } from "./live/snapshot";
import { rollCallHref } from "./rollcall";
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
      href: rollCallHref(snapshot.file!, roll.id),
      bill: roll.bill,
      title: roll.title,
      summary: roll.summary,
      summarySource: roll.summarySource,
      meaning: roll.meaning,
      chamber: snapshot.chamber,
      state: chamberState(snapshot.chamber),
      kind: roll.kind,
      outcome: roll.outcome,
      tally: [split.yes, split.no],
      split: split.kind !== "unanimous",
      splitKind: split.kind,
      close: split.close,
      contention: contention(split, roll.kind),
      parties: D || R ? { D: D && [D.yes, D.no], R: R && [R.yes, R.no] } : undefined,
      question: roll.question,
      date: roll.date,
      dateLabel: roll.dateLabel,
      sourceUrl: roll.sourceUrl,
      sourceLabel: snapshot.sourceLabel,
      topics: rollCallTopics(roll),
      representatives: [],
    } satisfies IssueRecord;
  })).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return allRecords;
}

/** Most contested substantive roll calls matching `where`; at most one per state when `perState`. */
export function topContested(where: (record: IssueRecord) => boolean, max: number, perState = false): IssueRecord[] {
  const picked: IssueRecord[] = [];
  const seen = new Set<string>();
  const hits = baseRecords().filter((r) => r.kind === "substantive" && r.contention > 0 && where(r));
  for (const r of sortIssueRecords(hits, "contested")) {
    // One card per bill (several readings of one bill rank alike); per state when asked.
    const key = perState ? r.state : `${r.chamber}|${r.bill || r.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(r);
    if (picked.length === max) break;
  }
  return picked;
}

/** ISO date `days` ago. */
export const daysAgo = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

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
