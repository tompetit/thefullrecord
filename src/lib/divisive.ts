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
function majority(p?: { yes: number; no: number }): "yes" | "no" | undefined {
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
