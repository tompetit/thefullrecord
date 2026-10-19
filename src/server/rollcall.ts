import { brokeWithParty, majority, type PartySplit } from "../lib/divisive";
import { getSnapshots, partyFor, rollCallSplit, type ChamberSnapshot, type SnapshotRollCall } from "./live/snapshot";
import { getAssemblyRoster, getCongressRoster, getCouncilRoster, getStateLegislatureRoster, getStateSenateRoster } from "./live/rosters";
import type { VoteChoice } from "./types";

export const rollCallHref = (file: string, id: string) => `/vote/${file}/${encodeURIComponent(id)}`;

export function getRollCall(file: string, id: string): { snapshot: ChamberSnapshot; roll: SnapshotRollCall } | null {
  const snapshot = getSnapshots().find((s) => s.file === file);
  const roll = snapshot?.rollCalls.find((r) => r.id === id);
  return snapshot && roll ? { snapshot, roll } : null;
}

export interface RollMember {
  key: string;
  name: string;
  party?: string;
  district?: string;
  vote: VoteChoice;
  /** /official/<id> when the member is on the current roster */
  officialId?: string;
  broke: boolean;
}

export interface PartyTally { yes: number; no: number; present: number; absent: number }

export interface RollCallDetail {
  snapshot: ChamberSnapshot;
  roll: SnapshotRollCall;
  split: PartySplit;
  members: RollMember[];
  /** Party code ("D", "R", "other") -> tally */
  tally: Record<string, PartyTally>;
  total: PartyTally;
  /** false when a roster fetch failed, so names may be missing */
  namesOk: boolean;
}

interface Who { name: string; district?: string; officialId?: string }
const lastToken = (n: string) => n.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/).pop() ?? "";

/** Name, district and official page for each member key; partial on roster failure. */
async function whoIs(snapshot: ChamberSnapshot, keys: string[]): Promise<{ who: Map<string, Who>; ok: boolean }> {
  const who = new Map<string, Who>();
  const snapMembers = new Map((snapshot.members ?? []).map((m) => [m.key, m]));
  try {
    if (snapshot.keyBy === "openstates" && snapshot.jurisdiction && snapshot.legislativeChamber) {
      const st = snapshot.jurisdiction;
      for (const m of await getStateLegislatureRoster(st)) {
        if (m.chamber === snapshot.legislativeChamber) who.set(`ocd-person/${m.id}`, { name: m.name, district: m.districtLabel, officialId: `${st}-${m.chamber}-${m.id}` });
      }
    } else if (snapshot.chamber === "U.S. HOUSE" || snapshot.chamber === "U.S. SENATE") {
      const roster = await getCongressRoster();
      const byBioguide = new Map([...roster.house.values(), ...[...roster.senators.values()].flat()].map((m) => [m.bioguide, m]));
      const seatOf = new Map(Object.entries(snapshot.memberKeys ?? {}).map(([seat, b]) => [b, seat]));
      for (const key of keys) {
        const m = byBioguide.get(key);
        if (!m) continue;
        const seat = seatOf.get(key);
        const house = seat?.match(/^([a-z]{2})-(\d+|al)$/);
        const sen = seat?.match(/^sen-([a-z]{2})-([12])$/);
        who.set(key, { name: m.name, district: m.district ? `${m.state}-${m.district.toUpperCase()}` : m.state, officialId: house ? `us-house-${house[1]}-${house[2]}` : sen ? `us-sen-${sen[1]}-${sen[2]}` : undefined });
      }
    } else {
      const [roster, prefix] = snapshot.chamber === "NY SENATE" ? [await getStateSenateRoster(), "ny-sd"] : snapshot.chamber === "NY ASSEMBLY" ? [await getAssemblyRoster(), "ny-ad"] : snapshot.chamber === "NYC COUNCIL" ? [await getCouncilRoster(), "nyc-council"] : [null, ""];
      for (const key of keys) {
        const sm = snapMembers.get(key);
        const cur = roster?.get(key);
        // NY seats are keyed by district: link only when today's holder is the member who cast the vote.
        const same = cur && (!sm || cur.name.toLowerCase().includes(lastToken(sm.name)));
        if (sm || cur) who.set(key, { name: sm?.name ?? cur!.name, district: sm?.district ?? key, officialId: same ? `${prefix}-${key}` : undefined });
      }
    }
    return { who, ok: true };
  } catch {
    return { who, ok: false };
  }
}

const empty = (): PartyTally => ({ yes: 0, no: 0, present: 0, absent: 0 });
const NO_NAME = new Set(["Former member", "Name unavailable"]);

export async function getRollCallDetail(file: string, id: string): Promise<RollCallDetail | null> {
  const hit = getRollCall(file, id);
  if (!hit) return null;
  const { snapshot, roll } = hit;
  const split = rollCallSplit(snapshot, roll);
  const keys = Object.keys(roll.votes);
  const { who, ok } = await whoIs(snapshot, keys);
  const snapMembers = new Map((snapshot.members ?? []).map((m) => [m.key, m]));
  const tally: Record<string, PartyTally> = {};
  const total = empty();
  const members: RollMember[] = keys.map((key) => {
    const vote = roll.votes[key];
    const party = partyFor(snapshot, key);
    const bucket = (tally[party === "D" || party === "R" ? party : "other"] ??= empty());
    bucket[vote]++;
    total[vote]++;
    const w = who.get(key);
    const sm = snapMembers.get(key);
    return { key, name: w?.name ?? sm?.name ?? (ok ? "Former member" : "Name unavailable"), party, district: w?.district ?? sm?.district, vote, officialId: w?.officialId, broke: brokeWithParty(vote, party, split) };
  });
  members.sort((a, b) => Number(NO_NAME.has(a.name)) - Number(NO_NAME.has(b.name)) || a.name.localeCompare(b.name));
  return { snapshot, roll, split, members, tally, total, namesOk: ok };
}

/** "Most Democrats voted no; most Republicans voted yes." (empty when neither party has a clear side) */
export function partySides(split: PartySplit): string {
  return ([["D", "Democrats"], ["R", "Republicans"]] as const)
    .flatMap(([p, name]) => { const side = majority(split.byParty[p]); return side ? [`most ${name} voted ${side}`] : []; })
    .join("; ").replace(/^./, (c) => c.toUpperCase());
}
