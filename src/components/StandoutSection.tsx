import Link from "next/link";
import { partyName, standoutSentence, topStandoutVotes, type Standout } from "@/lib/divisive";
import { SourceLink } from "./SourceLink";

/** "Where they stood out": votes against the member's own party's majority. Neutral styling, no scores. */
export function StandoutSection({
  standout,
  max = 5,
  fullRecordHref,
}: {
  standout: Standout;
  max?: number;
  /** Compact use (voter guide): link to the full official page instead of explaining */
  fullRecordHref?: string;
}) {
  const votes = topStandoutVotes(standout, max);
  const party = partyName(standout.party);
  return (
    <section aria-labelledby="stood-out" className="rounded-lg border border-card bg-paper-raised p-4 shadow-card">
      <h2 id="stood-out" className="font-serif text-[17px] font-bold text-ink">Where they stood out</h2>
      <p className="mt-1.5 font-sans text-[13.5px] leading-[1.5] text-ink-80">{standoutSentence(standout)}</p>
      {votes.length > 0 && (
        <ul className="mt-2 flex flex-col divide-y divide-hairline-soft">
          {votes.map((v) => (
            <li key={v.id} className="py-3">
              <p className="line-clamp-2 font-serif text-[15px] font-bold leading-[1.3] text-ink">{v.title}</p>
              {v.summary && (
                <p className="mt-1 font-sans text-[13px] leading-[1.5] text-ink-80">
                  <span className="font-semibold">What it does:</span> {v.summary.length > 220 ? `${v.summary.slice(0, 217).trimEnd()}…` : v.summary}
                </p>
              )}
              <p className="mt-1 font-sans text-xs leading-[1.5] text-ink-60">
                Voted {v.vote} · most {party} voted {v.partySide} · {v.breakdown}
              </p>
              <p className="flex flex-wrap items-center gap-x-2 font-sans text-xs text-ink-60">
                <span>{v.dateLabel}</span>
                <span className="inline-flex min-h-11 items-center">
                  <SourceLink href={v.sourceUrl}>Official record</SourceLink>
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="flex flex-wrap items-center gap-x-4 font-sans text-xs">
        {fullRecordHref && (
          <Link href={fullRecordHref} className="inline-flex min-h-11 items-center font-semibold text-accent underline">
            Full voting record
          </Link>
        )}
        <Link href="/coverage#party-splits" className="inline-flex min-h-11 items-center text-ink-60 underline">
          How this is counted
        </Link>
      </p>
    </section>
  );
}
