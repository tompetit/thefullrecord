import Link from "next/link";
import type { VoteRecord } from "@/server/types";
import { AiMarker } from "./AiMarker";
import { SourceLink } from "./SourceLink";
import { VoteBadge } from "./VoteBadge";

const Dot = () => <span className="text-[#c9c0ac]">·</span>;

/**
 * The vote card — the atomic unit of the product.
 * Eyebrow · serif title · vote badge · AI summary + marker · metadata footer.
 * Procedural/absent records may omit the AI summary block.
 */
export function VoteCard({
  vote,
  desktop = false,
}: {
  vote: VoteRecord;
  desktop?: boolean;
}) {
  const title = vote.billId ? (
    <Link href={`/bill/${vote.billId}`} className="hover:underline">
      {vote.title}
    </Link>
  ) : (
    vote.title
  );

  return (
    <article className="flex flex-col rounded-lg border border-card bg-paper-raised px-4 pt-4 shadow-card transition-shadow hover:shadow-card-raised">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-[3px]">
          <div className="font-sans text-[11px] font-bold tracking-[0.06em] text-ink-45">
            {vote.billNumber} · {vote.chamber}
          </div>
          <h3
            className={`font-serif font-bold leading-[1.3] text-ink text-pretty ${
              desktop ? "text-lg" : "text-[16.5px]"
            }`}
          >
            {title}
          </h3>
        </div>
        <VoteBadge vote={vote.vote} />
      </div>

      {vote.question && <p className="mt-3 font-sans text-xs leading-relaxed text-ink-60"><span className="font-semibold">Motion:</span> {vote.question}</p>}

      {vote.aiSummary && (
        <>
          <p className="mt-2.5 font-sans text-[13.5px] leading-[1.55] text-ink-80 text-pretty">
            {vote.aiSummary}
          </p>
          <AiMarker
            billTextUrl={vote.billId ? `/bill/${vote.billId}` : vote.sourceUrl}
            source={vote.summarySource ?? "ai"}
          />
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline-soft py-[11px] font-sans text-xs text-ink-60">
        <span className="font-semibold text-ink-80">{vote.outcome}</span>
        <Dot />
        <span>{vote.kind === "substantive" ? "Substantive" : "Procedural"}</span>
        <Dot />
        <span>{vote.dateLabel}</span>
        <span className="ml-auto">
          <SourceLink href={vote.sourceUrl}>
            {desktop ? vote.sourceLabel : "Roll call"}
          </SourceLink>
        </span>
      </div>
    </article>
  );
}
