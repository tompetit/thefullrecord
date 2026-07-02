"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Glyph } from "@/components/Glyph";
import { Wordmark } from "@/components/Wordmark";
import { SourceLink } from "@/components/SourceLink";
import { VoteBadge } from "@/components/VoteBadge";
import { useAddress } from "@/components/useAddress";
import { siteStats } from "@/server/seed";

const LEVELS = ["NYC Council", "State Assembly", "State Senate", "U.S. Congress"];

export default function Home() {
  const router = useRouter();
  const { setAddress } = useAddress();
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (value.trim()) setAddress(value.trim());
    router.push("/representatives");
  }

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

          <form onSubmit={submit} className="mt-6 flex max-w-md flex-col gap-2.5 lg:flex-row">
            <label className="flex flex-1 items-center gap-2 rounded-[10px] border-[1.5px] border-ink bg-paper-raised px-4 py-[15px]">
              <Glyph name="target" className="text-[15px] text-ink-45" />
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Your street address"
                autoComplete="street-address"
                className="w-full bg-transparent font-sans text-[15px] text-ink outline-none placeholder:text-ink-35"
              />
            </label>
            <button
              type="submit"
              className="min-h-11 cursor-pointer rounded-[10px] bg-ink px-6 py-[15px] font-sans text-[15px] font-bold text-paper hover:opacity-90"
            >
              Find my representatives
            </button>
          </form>
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
                  S4821-A · SENATE
                </div>
                <h3 className="font-serif text-[16.5px] font-bold leading-[1.3] text-ink text-pretty">
                  Residential Utility Billing Transparency Act [placeholder]
                </h3>
              </div>
              <VoteBadge vote="yes" />
            </div>
            <p className="mt-2.5 font-sans text-[13.5px] leading-[1.55] text-ink-80 text-pretty">
              Requires utilities to itemize delivery charges and give 60
              days&rsquo; notice before rate changes. [placeholder]
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline-soft py-[11px] font-sans text-xs text-ink-60">
              <span className="font-semibold text-ink-80">Passed 42–18 [placeholder]</span>
              <span className="text-[#c9c0ac]">·</span>
              <span>Jun 12, 2026</span>
              <span className="ml-auto">
                <SourceLink href="#">Roll call</SourceLink>
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
          {siteStats.trustLine}. Every claim on this site links to the primary
          source. Non-partisan · no scores, no grades.
        </p>
      </footer>
    </main>
  );
}
