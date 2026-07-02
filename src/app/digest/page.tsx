import Link from "next/link";
import { ReportIssue } from "@/components/ReportIssue";
import { SourceLink } from "@/components/SourceLink";
import { VoteBadge } from "@/components/VoteBadge";
import { Wordmark } from "@/components/Wordmark";
import { getDataSource } from "@/server/datasource";
import { SAMPLE_ADDRESS_SHORT } from "@/server/seed";

export const metadata = { title: "Weekly digest — The Full Record" };

/**
 * Weekly digest email — visual preview rendered in an email-client frame.
 * NOTE: the production *sendable* email must be rebuilt with table-based
 * layout and fully inline styles (many clients strip <style>; Outlook has
 * no flexbox/grid). This page is a faithful preview, not the sendable HTML.
 */
export default async function DigestPage() {
  const digest = await getDataSource().getDigest("");

  return (
    <main className="flex flex-1 items-start justify-center bg-canvas px-4 py-8">
      <div className="w-full max-w-[520px] rounded-xl bg-paper-raised p-6 shadow-card">
        {/* Header */}
        <div className="text-center">
          <Wordmark asLink={false} className="text-[17px]" />
          <h1 className="mt-2 font-serif text-[21px] font-semibold leading-[1.25] text-ink text-pretty">
            What your representatives did this week
          </h1>
          <p className="mt-1 font-sans text-xs text-ink-60">
            {digest.dateRangeLabel} · for {SAMPLE_ADDRESS_SHORT}, Brooklyn
          </p>
        </div>

        {/* Compact vote cards */}
        <div className="mt-5 flex flex-col gap-3">
          {digest.items.map((item) => (
            <article
              key={`${item.officialId}-${item.billNumber}`}
              className="rounded-lg border border-card bg-paper p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="font-sans text-xs text-ink-60">
                  <span className="font-serif text-[13.5px] font-bold text-ink">
                    {item.officialName}
                  </span>{" "}
                  · {item.chamber} · {item.billNumber}
                </div>
                <VoteBadge vote={item.vote} compact />
              </div>
              <p className="mt-2 font-sans text-[13px] leading-[1.5] text-ink-80 text-pretty">
                {item.summary}
              </p>
              <p className="mt-2 font-sans text-xs text-ink-60">
                {item.outcome} · {item.dateLabel} ·{" "}
                <SourceLink href={item.sourceUrl} className="text-xs">
                  Roll call
                </SourceLink>
              </p>
            </article>
          ))}
        </div>

        <p className="mt-4 text-center font-sans text-xs text-ink-45">
          {digest.quietLine}
        </p>

        {/* CTA */}
        <div className="mt-5 text-center">
          <Link
            href="/representatives"
            className="inline-block rounded-lg bg-ink px-5 py-3 font-sans text-[13px] font-bold text-paper"
          >
            See the full week on The Full Record
          </Link>
        </div>

        {/* Footer */}
        <div className="mt-6 border-t border-hairline-soft pt-4 text-center font-sans text-[11px] leading-[1.6] text-ink-45">
          <div>
            Summaries are AI-generated — every item links to the official
            record. <ReportIssue subjectType="other" subjectId="digest" />
          </div>
          <p className="mt-2">
            You receive this weekly for your saved address.{" "}
            <Link href="/" className="underline">
              Change address
            </Link>{" "}
            ·{" "}
            <Link href="#" className="underline">
              Unsubscribe
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
