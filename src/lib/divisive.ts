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
  for (const [key, v] of Object.entries(votes)) {
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
}

export interface StandoutInput {
  vote: string;
  split: PartySplit;
  meta: Omit<StandoutVote, "vote" | "partySide" | "breakdown">;
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
  for (const { vote, split, meta } of inputs) {
    if (split.kind !== "party-line" && split.kind !== "crossed") continue;
    if (vote !== "yes" && vote !== "no") continue;
    const side = majority(split.byParty[party]);
    if (!side) continue;
    m++;
    if (brokeWithParty(vote, party, split))
      votes.push({ ...meta, vote, partySide: side, breakdown: breakdown(split) });
  }
  if (m < MIN_DIVIDED) return null;
  votes.sort((a, b) => b.date.localeCompare(a.date));
  return { party, m, n: votes.length, votes };
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
