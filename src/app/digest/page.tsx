import Link from "next/link";
import { SourceLink } from "@/components/SourceLink";
import { VoteBadge } from "@/components/VoteBadge";
import { Wordmark } from "@/components/Wordmark";
import { getDataSource } from "@/server/datasource";
import { SAMPLE_ADDRESS } from "@/server/data";
import { AddressLookupForm } from "@/components/AddressLookupForm";

export const metadata = { title: "Weekly digest — The Full Record" };

/**
 * Weekly digest email — visual preview rendered in an email-client frame.
 * NOTE: the production *sendable* email must be rebuilt with table-based
 * layout and fully inline styles (many clients strip <style>; Outlook has
 * no flexbox/grid). This page is a faithful preview, not the sendable HTML.
 */
export default async function DigestPage({ searchParams }: { searchParams: Promise<{ address?: string }> }) {
  const query = await searchParams;
  const address = typeof query.address === "string" ? query.address.trim().slice(0, 250) : "";
  const ds = getDataSource();
  if (address) {
    const lookup = await ds.getOfficialsByAddress(address);
    if (!lookup.ok) return <main className="mx-auto max-w-2xl p-6"><Wordmark /><h1 className="mt-6 font-serif text-2xl">We couldn’t look up that address</h1><p className="mt-3">Check the address and try again. No sample records have been substituted.</p><AddressLookupForm initialAddress={address} /></main>;
  }
  const digest = await ds.getDigest(address);

  return (
    <main className="flex flex-1 items-start justify-center bg-canvas px-4 py-8">
      <div className="w-full max-w-[520px] rounded-xl bg-paper-raised p-6 shadow-card">
        {/* Header */}
        <div className="text-center">
          <Wordmark asLink={false} className="text-[17px]" />
          <h1 className="mt-2 font-serif text-[21px] font-semibold leading-[1.25] text-ink text-pretty">
            Recent recorded votes
          </h1>
          <p className="mt-1 font-sans text-xs text-ink-60">
            {digest.dateRangeLabel} · {address || `Sample district: ${SAMPLE_ADDRESS}`}
          </p>
        </div>

        <p className="mt-4 rounded-lg border border-hairline-soft p-3 font-sans text-xs leading-relaxed text-ink-60">{address ? "Records for the address above." : "This is a sample district preview, not a personalized digest."} This collection may lag official records. Missing votes do not establish that an official took no action.</p>
        {/* Compact vote cards */}
        <div className="mt-5 flex flex-col gap-3">
          {digest.items.map((item) => (
            <article
              key={`${item.officialId}-${item.billNumber}-${item.dateLabel}-${item.sourceUrl}`}
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
            href={address ? `/representatives?address=${encodeURIComponent(address)}` : "/representatives"}
            className="inline-block rounded-lg bg-ink px-5 py-3 font-sans text-[13px] font-bold text-paper"
          >
            Explore representative records
          </Link>
        </div>

        {/* Footer */}
        <div className="mt-6 border-t border-hairline-soft pt-4 text-center font-sans text-[11px] leading-[1.6] text-ink-45">
          <div>
            Every entry links to its source. Check the motion and official roll call before interpreting a vote.
          </div>
          <p className="mt-2">
            This is a web preview; no email subscription is created.
            {" "}<Link href="/representatives" className="underline">Look up another address</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
