import Link from "next/link";
import { AddressLookupForm } from "@/components/AddressLookupForm";
import { SourceLink } from "@/components/SourceLink";
import { VoteBadge } from "@/components/VoteBadge";
import { Wordmark } from "@/components/Wordmark";
import { getDataSource } from "@/server/datasource";

const LEVELS = ["NYC Council", "State Assembly", "State Senate", "U.S. Congress"];

export default async function Home() {
  const stats = await getDataSource().getSiteStats();

  return (
    <main className="flex min-h-screen flex-1 flex-col">
      {/* Top bar — nav links appear on desktop only */}
      <header className="flex items-center justify-between px-[26px] pt-5 lg:px-10">
        <Wordmark className="text-[20px]" />
        <nav className="hidden items-center gap-6 font-sans text-[13px] text-ink-60 lg:flex">
          <Link href="#" className="hover:text-ink">Bills</Link>
          <Link href="#" className="hover:text-ink">How it works</Link>
          <Link href="#" className="hover:text-ink">About</Link>
        </nav>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-[70px] px-[26px] pt-14 lg:grid-cols-[1fr_400px] lg:px-10 lg:pt-20">
        {/* Hero + lookup */}
        <section>
          <h1 className="font-serif text-[33px] font-semibold leading-[1.18] tracking-[-0.015em] text-ink text-pretty lg:text-[50px]">
            Every level.
            <br />
            Every vote.
            <br />
            The full record.
          </h1>
          <p className="mt-4 max-w-md font-sans text-[14.5px] leading-[1.6] text-ink-60 lg:text-base">
            Enter your address to see everyone who represents you in New York —
            and what they have actually done, traced to the primary record.
          </p>

          <AddressLookupForm />
          <p className="mt-2.5 font-sans text-[11.5px] text-ink-45">
            Your address is used once for the lookup and never stored.
          </p>
        </section>

        {/* Desktop: a live sample vote card */}
        <aside className="hidden lg:block">
          <div className="font-sans text-[11px] font-bold tracking-[0.09em] text-ink-45">
            WHAT A RECORD LOOKS LIKE
          </div>
          <article className="mt-3 rounded-lg border border-card bg-paper-raised px-4 pt-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-[3px]">
                <div className="font-sans text-[11px] font-bold tracking-[0.06em] text-ink-45">
                  S9408-A · NY SENATE
                </div>
                <h3 className="font-serif text-[16.5px] font-bold leading-[1.3] text-ink text-pretty">
                  AI chatbot toys moratorium
                </h3>
              </div>
              <VoteBadge vote="yes" />
            </div>
            <p className="mt-2.5 font-sans text-[13.5px] leading-[1.55] text-ink-80 text-pretty">
              Places a five-year moratorium on selling AI-companion toys for
              children while a state study examines their risks and benefits.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline-soft py-[11px] font-sans text-xs text-ink-60">
              <span className="font-semibold text-ink-80">Passed Senate 57–3</span>
              <span className="text-[#c9c0ac]">·</span>
              <span>Jun 1, 2026</span>
              <span className="ml-auto">
                <SourceLink href="https://www.nysenate.gov/legislation/bills/2025/S9408/amendment/A">
                  Roll call
                </SourceLink>
              </span>
            </div>
          </article>
          <p className="mt-3 font-sans text-xs leading-normal text-ink-45">
            Every claim links to the primary source. Non-partisan · no scores,
            no grades.
          </p>
        </aside>
      </div>

      {/* Footer pinned to bottom */}
      <footer className="mt-auto border-t border-hairline px-[26px] py-6 lg:px-10">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-3 font-sans text-xs font-semibold text-ink-80 sm:grid-cols-4">
          {LEVELS.map((level) => (
            <span key={level}>{level}</span>
          ))}
        </div>
        <p className="mx-auto mt-4 max-w-6xl font-sans text-xs leading-[1.6] text-ink-45">
          {stats.trustLine}. Every claim on this site links to the primary
          source. Non-partisan · no scores, no grades.
        </p>
      </footer>
    </main>
  );
}
