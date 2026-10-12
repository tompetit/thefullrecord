import { getSnapshots, memberKeyFor, partyFor, rollCallSplit, rollCallTopics, type ChamberSnapshot } from "./live/snapshot";
import { summarizeStandout, type Standout, type StandoutInput } from "../lib/divisive";

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
