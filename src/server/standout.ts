import { getSnapshots, memberKeyFor, partyFor, rollCallSplit, rollCallTopics, type ChamberSnapshot } from "./live/snapshot";
import { breakdown, contention, majority, summarizeStandout, type ContestedVote, type Standout, type StandoutInput } from "../lib/divisive";
import { rollCallHref } from "./rollcall";
import { summarizeByIssue, type IssueRow, type IssueVoteInput } from "../lib/issueRecord";

function compute(keyOf: (s: ChamberSnapshot) => string | null): Standout | null {
  for (const snap of getSnapshots()) {
    const key = keyOf(snap);
    if (!key) continue;
    const inputs: StandoutInput[] = [];
    for (const rc of snap.rollCalls) {
      const vote = rc.votes[key];
      if (vote !== "yes" && vote !== "no") continue;
      inputs.push({
        vote,
        split: rollCallSplit(snap, rc),
        topics: rollCallTopics(rc),
        meta: {
          id: rc.id,
          bill: rc.bill,
          title: rc.title,
          summary: rc.summary && rc.summary !== rc.title ? rc.summary : undefined,
          meaning: rc.meaning,
          kind: rc.kind,
          date: rc.date,
          dateLabel: rc.dateLabel,
          sourceUrl: rc.sourceUrl,
          chamber: snap.chamber,
        },
      });
    }
    const result = summarizeStandout(partyFor(snap, key), inputs);
    if (result) return result;
  }
  return null;
}

export const standoutForDistrict = (districtKey: string) => compute((s) => memberKeyFor(s, districtKey));

/** Congress members: the bioguide id is the snapshot member key. */
export const standoutForBioguide = (id: string) =>
  compute((s) =>
    (s.chamber === "U.S. HOUSE" || s.chamber === "U.S. SENATE") && s.rollCalls.some((r) => r.votes[id]) ? id : null,
  );

function contested(keyOf: (s: ChamberSnapshot) => string | null, max: number): ContestedVote[] {
  for (const snap of getSnapshots()) {
    const key = keyOf(snap);
    if (!key) continue;
    const party = partyFor(snap, key);
    const ranked: Array<{ score: number; bill: string; vote: ContestedVote }> = [];
    for (const rc of snap.rollCalls) {
      const vote = rc.votes[key];
      if ((vote !== "yes" && vote !== "no") || rc.kind !== "substantive") continue;
      const split = rollCallSplit(snap, rc);
      const score = contention(split, rc.kind);
      if (!score) continue;
      ranked.push({ score, bill: rc.bill, vote: { id: rc.id, href: rollCallHref(snap.file!, rc.id), title: rc.title, date: rc.date, dateLabel: rc.dateLabel, sourceUrl: rc.sourceUrl, outcome: rc.outcome, vote, partySide: party ? majority(split.byParty[party]) : undefined, breakdown: breakdown(split), tally: [split.yes, split.no] } });
    }
    if (!ranked.length) continue;
    // One row per bill: a bill's readings and concurrences tend to rank alike.
    const seen = new Set<string>();
    return ranked
      .sort((a, b) => b.score - a.score || b.vote.date.localeCompare(a.vote.date))
      .filter(({ vote, bill }) => !seen.has(bill || vote.title) && Boolean(seen.add(bill || vote.title)))
      .slice(0, max)
      .map((x) => x.vote);
  }
  return [];
}

export const contestedForDistrict = (districtKey: string, max = 8) => contested((s) => memberKeyFor(s, districtKey), max);

export const contestedForBioguide = (id: string, max = 8) =>
  contested((s) => ((s.chamber === "U.S. HOUSE" || s.chamber === "U.S. SENATE") && s.rollCalls.some((r) => r.votes[id]) ? id : null), max);

function byIssue(keyOf: (s: ChamberSnapshot) => string | null): IssueRow[] | null {
  for (const snap of getSnapshots()) {
    const key = keyOf(snap);
    if (!key) continue;
    const inputs: IssueVoteInput[] = [];
    for (const rc of snap.rollCalls) {
      const vote = rc.votes[key];
      if (vote !== "yes" && vote !== "no") continue;
      inputs.push({
        vote,
        split: rollCallSplit(snap, rc),
        topics: rollCallTopics(rc),
        kind: rc.kind,
        bill: rc.bill,
        example: { id: rc.id, href: rollCallHref(snap.file!, rc.id), title: rc.title, summary: rc.summary && rc.summary !== rc.title ? rc.summary : undefined, date: rc.date, dateLabel: rc.dateLabel, sourceUrl: rc.sourceUrl, outcome: rc.outcome, vote },
      });
    }
    const rows = summarizeByIssue(partyFor(snap, key), inputs);
    if (rows) return rows;
  }
  return null;
}

export const issuesForDistrict = (districtKey: string) => byIssue((s) => memberKeyFor(s, districtKey));
