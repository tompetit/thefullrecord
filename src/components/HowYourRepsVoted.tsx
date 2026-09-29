"use client";

import type { Bill, Official, VoteChoice } from "@/server/types";
import { VoteBadge } from "./VoteBadge";
import Link from "next/link";

/** Green callout on bill detail: how the reps for the saved address voted. */
export function HowYourRepsVoted({
  officials,
  votes,
}: {
  bill: Bill;
  officials: Official[];
  votes: Array<{ officialId: string; vote: VoteChoice }>;
}) {

  return (
    <section className="rounded-lg border border-accent-tint-border bg-accent-tint p-4">
      <h3 className="font-sans text-[11px] font-bold tracking-[0.06em] text-accent-soft">
        SELECTED RECORDED VOTES
      </h3>
      <ul className="mt-3 flex flex-col gap-2">
        {officials.map((o) => {
          const v = votes.find((x) => x.officialId === o.id);
          if (!v) return null;
          return (
            <li key={o.id} className="flex items-center justify-between gap-3">
              <span className="font-sans text-[13px] text-ink-80">
                <span className="font-serif text-[15px] font-bold text-ink">
                  {o.name}
                </span>{" "}
                · {o.role}
              </span>
              <VoteBadge vote={v.vote} compact />
            </li>
          );
        })}
      </ul>
      <p className="mt-3 font-sans text-[11.5px] leading-normal text-ink-60">
        These are selected records for this bill, not a personalized list of your representatives. A vote on a companion bill may be a separate legislative action.
      </p>
      <Link href="/representatives" className="mt-3 inline-block font-sans text-xs underline">Find your representatives →</Link>
    </section>
  );
}
