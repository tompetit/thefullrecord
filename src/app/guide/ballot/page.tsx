import Link from "next/link";
import { BallotAddressForm } from "@/components/guide/BallotAddressForm";
import { stateName } from "@/components/guide/RaceView";
import { GuideFooter, GuideNav, IncumbentTag, Monogram, OFFICE_LABEL, PartyChips, SectionLabel } from "@/components/guide/ui";
import { ballotForAddress } from "@/server/guide/ballot";

export const metadata = { title: "My 2026 ballot — The Full Record" };

const MESSAGES = {
  "no-match": "We couldn't match that address. Include the street number, city, and state or ZIP code.",
  "lookup-failed": "The Census district lookup didn't respond. Try again in a moment.",
};

export default async function BallotPage({ searchParams }: { searchParams: Promise<{ address?: string }> }) {
  const query = await searchParams;
  const address = typeof query.address === "string" ? query.address.trim().slice(0, 250) : "";
  const result = address ? await ballotForAddress(address) : null;

  return (
    <main className="flex-1">
      <GuideNav active="ballot" />
      <div className="mx-auto w-full max-w-5xl px-[20px] pt-8 lg:px-10">
        <h1 className="font-serif text-[30px] font-semibold tracking-[-0.015em] text-ink lg:text-[40px]">
          My ballot
        </h1>
        {!result && (
          <>
            <p className="mt-2 max-w-xl font-sans text-[14.5px] leading-[1.6] text-ink-60">
              Enter your address to see the races on your November 3 ballot.
              Any U.S. address shows your House and Senate races; New York
              addresses also show state races and ballot proposals.
            </p>
            <BallotAddressForm />
          </>
        )}
        {result && !result.ok && (
          <>
            <p className="mt-4 max-w-lg rounded-lg border border-hairline-soft bg-paper-raised p-4 font-sans text-[13.5px] text-ink-60">
              {MESSAGES[result.reason]}
            </p>
            <BallotAddressForm />
          </>
        )}
        {result?.ok && (
          <>
            <p className="mt-2 font-sans text-[14px] text-ink-60">
              {result.matchedAddress} · {stateName(result.state)}
              {result.districts.congressional && ` · Congressional District ${result.districts.congressional === "0" ? "at-large" : result.districts.congressional}`}
              {result.state === "NY" && result.districts.stateSenate && ` · State Senate ${result.districts.stateSenate}`}
              {result.state === "NY" && result.districts.assembly && ` · Assembly ${result.districts.assembly}`}
              {" · "}
              <Link href="/guide/ballot" className="underline hover:text-ink">change</Link>
            </p>
            <p className="mt-3 max-w-2xl font-sans text-xs leading-relaxed text-ink-60">This is a researched guide, not an official sample ballot. Candidate lists and district coverage may be incomplete. Confirm your current ballot with your local election office.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/guide/match?address=${encodeURIComponent(address)}`}
                className="rounded-[10px] bg-ink px-4 py-2.5 font-sans text-[14px] font-bold text-paper hover:opacity-90"
              >
                Compare candidate evidence by issue →
              </Link>
            </div>
            {result.races.length === 0 && (
              <p className="mt-6 rounded-lg border border-hairline-soft bg-paper-raised p-4 font-sans text-[13.5px] text-ink-60">
                We haven&rsquo;t finished researching the races for this address yet.
              </p>
            )}
            <ol className="mt-8 flex flex-col gap-4">
              {result.races.map((r, i) => (
                <li key={r.id} className="rounded-xl border border-card bg-paper-raised p-4 lg:p-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <SectionLabel>
                      {i + 1}. {OFFICE_LABEL[r.officeType]}
                    </SectionLabel>
                    <Link href={`/guide/race/${r.id}`} className="whitespace-nowrap font-sans text-[12.5px] font-semibold text-accent">
                      Full comparison →
                    </Link>
                  </div>
                  <Link href={`/guide/race/${r.id}`} className="mt-1 block font-serif text-[20px] font-bold text-ink hover:underline">
                    {r.title}
                  </Link>
                  {r.officeType === "ballot-measure" && r.measure ? (
                    <p className="mt-1 font-sans text-[13px] leading-[1.55] text-ink-60">{r.measure.summary.text}</p>
                  ) : (
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                      {r.candidates.map((c) => (
                        <li key={c.id}>
                          <Link href={`/guide/race/${r.id}/${c.id}`} className="flex items-start gap-2.5 rounded-lg p-1.5 hover:bg-paper">
                            <Monogram name={c.name} size={36} />
                            <span className="min-w-0">
                              <span className="block font-serif text-[15.5px] font-bold leading-tight text-ink">{c.name}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-1">
                                <PartyChips parties={c.parties} />
                                {c.incumbent && <IncumbentTag />}
                              </span>
                              <span className="mt-0.5 line-clamp-2 block font-sans text-[12px] leading-snug text-ink-60">
                                {c.summary.text}
                              </span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
            {result.state !== "NY" && (
              <p className="mt-6 font-sans text-[12.5px] text-ink-45">
                Outside New York, this guide covers U.S. House and Senate races
. Your ballot may also include
                state and local contests — check your state election office.
              </p>
            )}
          </>
        )}
      </div>
      <GuideFooter />
    </main>
  );
}
