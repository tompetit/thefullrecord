import Link from "@/components/Link";
import type { ContestedVote } from "@/lib/divisive";
import { SourceLink } from "./SourceLink";
import { VoteBadge } from "./VoteBadge";

/** A member's votes on the most contested roll calls of their chamber. Neutral: no scores, no judgment of which side is right. */
export function ContestedVotesSection({ votes, max = 8, allHref }: { votes: ContestedVote[]; max?: number; allHref?: string }) {
  if (!votes.length) return null;
  return (
    <section aria-labelledby="contested-votes" className="border border-card bg-paper-raised p-4">
      <h2 id="contested-votes" className="font-sans text-[12px] font-bold uppercase tracking-[0.06em] text-ink">Their votes on the most contested roll calls</h2>
      <p className="mt-1.5 font-sans text-[13px] leading-[1.5] text-ink-60">The votes in their chamber that came out closest and most divided by party, among those they voted on. <Link href="/coverage#party-splits" className="underline">How we rank</Link></p>
      <ul className="mt-2 flex flex-col divide-y divide-hairline-soft">
        {votes.slice(0, max).map((v) => (
          <li key={v.id} className="flex items-start gap-3 py-3">
            <VoteBadge vote={v.vote} compact />
            <div className="min-w-0">
              <p className="line-clamp-2 font-serif text-[15px] font-bold leading-[1.3] text-ink"><Link href={v.href} className="hover:underline">{v.title}</Link></p>
              <p className="mt-1 font-sans text-xs leading-[1.5] text-ink-60">
                {v.partySide ? (v.partySide === v.vote ? "With most of their party" : "Against most of their party") : "Party majority unclear"} · {v.outcome} · Yes {v.tally[0]}–No {v.tally[1]}{v.breakdown && ` · ${v.breakdown}`}
              </p>
              <p className="flex flex-wrap items-center gap-x-2 font-sans text-xs text-ink-60">
                <span>{v.dateLabel}</span>
                <span className="inline-flex min-h-11 items-center"><SourceLink href={v.sourceUrl}>Official record</SourceLink></span>
              </p>
            </div>
          </li>
        ))}
      </ul>
      {allHref && <Link href={allHref} className="inline-flex min-h-11 items-center font-sans text-xs font-semibold text-accent underline">See all their split votes</Link>}
    </section>
  );
}
