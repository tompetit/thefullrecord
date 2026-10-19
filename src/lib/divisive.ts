/** Pure party-split logic for a roll call (no I/O). */
import type { VoteChoice } from "../server/types";

export type SplitKind = "unanimous" | "party-line" | "crossed" | "bipartisan" | "unknown";
export interface PartySplit {
  yes: number;
  no: number;
  byParty: Record<string, { yes: number; no: number }>;
  kind: SplitKind;
  /** Split vote decided by a margin of max(2, 5%) or less */
  close: boolean;
}

/** The side a party's yes/no voters mostly took; undefined for <2 voters or a tie. */
export function majority(p?: { yes: number; no: number }): "yes" | "no" | undefined {
  if (!p || p.yes + p.no < 2 || p.yes === p.no) return undefined;
  return p.yes > p.no ? "yes" : "no";
}

export function partySplit(
  votes: Record<string, VoteChoice>,
  party: (key: string) => string | undefined,
): PartySplit {
  let yes = 0;
  let no = 0;
  const byParty: PartySplit["byParty"] = {};
  // for-in, not Object.entries: this runs over every vote of ~50k roll calls on a cold start.
  for (const key in votes) {
    const v = votes[key];
    if (v !== "yes" && v !== "no") continue;
    if (v === "yes") yes++;
    else no++;
    const p = party(key);
    if (p) (byParty[p] ??= { yes: 0, no: 0 })[v]++;
  }
  const split = yes > 0 && no > 0;
  const close = split && Math.abs(yes - no) <= Math.max(2, 0.05 * (yes + no));
  const [d, r] = [majority(byParty.D), majority(byParty.R)];
  const cohesive = (p: { yes: number; no: number }) =>
    Math.max(p.yes, p.no) >= 0.9 * (p.yes + p.no);
  let kind: SplitKind;
  if (!split) kind = "unanimous";
  else if (!d || !r) kind = "unknown";
  else if (d === r) kind = "bipartisan";
  else kind = cohesive(byParty.D) && cohesive(byParty.R) ? "party-line" : "crossed";
  return { yes, no, byParty, kind, close };
}

export const CONTENTION_EXPLANATION =
  "Votes are ranked by how close the final tally was and how far apart the two parties voted. A 218–214 vote with Democrats and Republicans on opposite sides ranks highest; a lopsided vote that both parties backed ranks low. Procedural votes (motions, amendments) count half as much as votes on a bill itself.";

/** 0 (unanimous) to 1: average of closeness of the tally and the gap between D and R yes-shares; procedural votes halved. */
export function contention(split: PartySplit, kind: "substantive" | "procedural"): number {
  const total = split.yes + split.no;
  if (split.yes === 0 || split.no === 0) return 0;
  const closeness = 1 - Math.abs(split.yes - split.no) / total;
  const { D, R } = split.byParty;
  const share = (p: { yes: number; no: number }) => p.yes / (p.yes + p.no);
  const gap = D && R && D.yes + D.no >= 2 && R.yes + R.no >= 2 ? Math.abs(share(D) - share(R)) : 0;
  return ((closeness + gap) / 2) * (kind === "procedural" ? 0.5 : 1);
}

/** True when the member voted yes/no against the strict majority of their own party. */
export function brokeWithParty(
  vote: VoteChoice,
  memberParty: string | undefined,
  split: PartySplit,
): boolean {
  if (vote !== "yes" && vote !== "no") return false;
  const side = memberParty ? majority(split.byParty[memberParty]) : undefined;
  return side !== undefined && side !== vote;
}

export interface StandoutVote {
  id: string;
  bill: string;
  title: string;
  summary?: string;
  meaning?: string;
  kind: "substantive" | "procedural";
  date: string;
  dateLabel: string;
  sourceUrl: string;
  chamber: string;
  vote: "yes" | "no";
  /** The side most of the member's party took */
  partySide: "yes" | "no";
  /** e.g. "Democrats 210–2, Republicans 3–215" (yes–no) */
  breakdown: string;
}

export interface Standout {
  party: "D" | "R";
  /** Party-divided votes where the member's party had a majority side */
  m: number;
  /** How many of those the member voted against that majority */
  n: number;
  /** The n votes, newest first */
  votes: StandoutVote[];
  /** Top 3 topic ids among the n votes with counts; only when at least MIN_DIVIDED of them have a topic */
  topTopics?: Array<[string, number]>;
}

export interface StandoutInput {
  vote: string;
  split: PartySplit;
  topics?: string[];
  meta: Omit<StandoutVote, "vote" | "partySide" | "breakdown">;
}

/** A member's vote on one of the most contested roll calls of their chamber. */
export interface ContestedVote {
  id: string;
  href: string;
  title: string;
  date: string;
  dateLabel: string;
  sourceUrl: string;
  outcome: string;
  vote: "yes" | "no";
  /** Side most of the member's party took; absent when the party had no clear side */
  partySide?: "yes" | "no";
  /** e.g. "Democrats 210–2, Republicans 3–215" (yes–no) */
  breakdown: string;
  tally: [number, number];
}

export const MIN_DIVIDED = 5;
const NAMES: Record<string, string> = { D: "Democrats", R: "Republicans" };

export function breakdown(split: PartySplit): string {
  return (["D", "R"] as const)
    .filter((p) => split.byParty[p])
    .map((p) => `${NAMES[p]} ${split.byParty[p].yes}–${split.byParty[p].no}`)
    .join(", ");
}

/** Null when the party is not D/R or the member has fewer than MIN_DIVIDED party-divided votes. */
export function summarizeStandout(party: string | undefined, inputs: StandoutInput[]): Standout | null {
  if (party !== "D" && party !== "R") return null;
  let m = 0;
  const votes: StandoutVote[] = [];
  const counts = new Map<string, number>();
  let tagged = 0;
  for (const { vote, split, meta, topics } of inputs) {
    if (split.kind !== "party-line" && split.kind !== "crossed") continue;
    if (vote !== "yes" && vote !== "no") continue;
    const side = majority(split.byParty[party]);
    if (!side) continue;
    m++;
    if (!brokeWithParty(vote, party, split)) continue;
    votes.push({ ...meta, vote, partySide: side, breakdown: breakdown(split) });
    if (topics?.length) tagged++;
    for (const t of topics ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  if (m < MIN_DIVIDED) return null;
  votes.sort((a, b) => b.date.localeCompare(a.date));
  const topTopics = tagged >= MIN_DIVIDED ? [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3) : undefined;
  return { party, m, n: votes.length, votes, topTopics };
}

/** Up to `max` votes, substantive first, newest first within each group. */
export function topStandoutVotes(s: Standout, max: number): StandoutVote[] {
  const sub = s.votes.filter((v) => v.kind === "substantive");
  return [...sub, ...s.votes.filter((v) => v.kind !== "substantive")].slice(0, max);
}

export function standoutSentence(s: Standout, short = false): string {
  const f = (x: number) => x.toLocaleString("en-US");
  if (s.n === 0 && s.m >= 10) return `Voted with most of their party on all ${f(s.m)} party-divided votes on file.`;
  return `Voted against most of their party on ${f(s.n)} of ${f(s.m)} party-divided votes${short ? "" : " on file"}.`;
}

export function partyName(p: string): string {
  return NAMES[p] ?? p;
}
