import Link from "@/components/Link";
import { BallotAddressForm } from "@/components/guide/BallotAddressForm";
import { stateName } from "@/components/guide/RaceView";
import { IncumbentTag, Monogram, OFFICE_LABEL, PartyChips, SectionLabel } from "@/components/guide/ui";
import { SourceLink } from "@/components/SourceLink";
import { VoteBadge } from "@/components/VoteBadge";
import { LOOKUP_MESSAGES } from "@/lib/site";
import { personHrefForOfficial } from "@/server/people";
import { ballotForAddress, type BallotStateSeat } from "@/server/guide/ballot";

export const metadata = {
  title: "My 2026 ballot — The Full Record",
  description: "Enter an address to see the researched 2026 races and candidates on your ballot, with sources.",
};

export default async function BallotPage({ searchParams }: { searchParams: Promise<{ address?: string }> }) {
  const query = await searchParams;
  const address = typeof query.address === "string" ? query.address.trim().slice(0, 250) : "";
  const result = address ? await ballotForAddress(address) : null;
  // Order: federal and statewide races, then state-legislative slates, then ballot measures.
  const pre = result?.ok ? result.races.filter((r) => r.officeType !== "ballot-measure") : [];
  const post = result?.ok ? result.races.filter((r) => r.officeType === "ballot-measure") : [];

  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 pt-8 lg:px-10">
        <h1 className="font-serif text-[30px] font-semibold tracking-[-0.015em] text-ink lg:text-[40px]">
          My ballot
        </h1>
        {!result && (
          <>
            <p className="mt-2 max-w-xl font-sans text-[14.5px] leading-[1.6] text-ink-60">
              Enter your address to see the races on your November 3 ballot.
              Any U.S. address shows your House and Senate races and, where we have the candidate list, your state legislative races. New York addresses also show researched state races and ballot proposals.
            </p>
            <BallotAddressForm />
          </>
        )}
        {result && !result.ok && (
          <>
            <p className="mt-4 max-w-lg border border-hairline-soft bg-paper-raised p-4 font-sans text-[13.5px] text-ink-60">
              {LOOKUP_MESSAGES[result.reason]}
            </p>
            <BallotAddressForm initialAddress={address} />
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
                className="bg-ink px-4 py-2.5 font-sans text-[14px] font-bold text-paper hover:opacity-90"
              >
                Compare by issue →
              </Link>
            </div>
            {result.races.length + result.stateSeats.length === 0 && (
              <p className="mt-6 border border-hairline-soft bg-paper-raised p-4 font-sans text-[13.5px] text-ink-60">
                We haven&rsquo;t finished researching the races for this address yet.
              </p>
            )}
            <ol className="mt-8 flex flex-col gap-4">
              {[...pre, ...result.stateSeats, ...post].map((r, i) =>
                "election" in r ? (
                  <StateSeatItem key={r.election.districtKey} n={i + 1} seat={r} />
                ) : (
                  <li key={r.id} className="border border-card bg-paper-raised p-4 lg:p-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <SectionLabel>
                        {i + 1}. {OFFICE_LABEL[r.officeType]}
                      </SectionLabel>
                      <Link href={`/guide/race/${r.id}`} className="whitespace-nowrap font-sans text-[12.5px] font-semibold text-accent">
                        Race details →
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
                            <Link href={`/guide/race/${r.id}/${c.id}`} className="flex items-start gap-2.5 p-1.5 hover:bg-paper">
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
                )
              )}
            </ol>
            {result.state !== "NY" && (
              <p className="mt-6 font-sans text-[12.5px] text-ink-45">
                Outside New York, only U.S. House and Senate and statewide races are researched in depth; state legislative races show candidate lists only. Your ballot may also include local contests; check your state election office.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function StateSeatItem({ n, seat }: { n: number; seat: BallotStateSeat }) {
  const { election: e } = seat;
  return (
    <li className="border border-card bg-paper-raised p-4 lg:p-5">
      <SectionLabel>
        {n}. {seat.office}
      </SectionLabel>
      <p className="mt-1 font-serif text-[20px] font-bold text-ink">{seat.title}</p>
      {e.seats && e.seats > 1 && <p className="mt-0.5 font-sans text-[12.5px] text-ink-60">Vote for up to {e.seats}.</p>}
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {e.candidates.map((c) => (
          <li key={c.name} className="flex items-start gap-2.5 p-1.5">
            <Monogram name={c.name} size={36} />
            <span className="min-w-0">
              <span className="block font-serif text-[15.5px] font-bold leading-tight text-ink">{c.name}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1">
                <PartyChips parties={c.parties} />
                {c.incumbent && <IncumbentTag />}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {seat.incumbents.map((inc) => (
        <div key={inc.officialId} className="mt-3 border-t border-hairline-soft pt-3">
          <h3 className="font-sans text-[13px] font-bold text-ink">How {inc.name} voted on the most contested votes</h3>
          {inc.contested.length > 0 ? (
            <ul className="mt-1 flex flex-col divide-y divide-hairline-soft">
              {inc.contested.map((v) => (
                <li key={v.id} className="flex items-start gap-3 py-2.5">
                  <VoteBadge vote={v.vote} compact />
                  <div className="min-w-0">
                    <p className="line-clamp-2 font-serif text-[14.5px] font-bold leading-[1.3] text-ink">
                      <Link href={v.href} className="hover:underline">{v.title}</Link>
                    </p>
                    <p className="mt-0.5 font-sans text-xs leading-[1.5] text-ink-60">
                      {v.partySide ? (v.partySide === v.vote ? "With most of their party" : "Against most of their party") : "Party majority unclear"}
                      {v.breakdown && ` · ${v.breakdown}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 font-sans text-xs text-ink-60">No contested votes for this member are in our dataset yet.</p>
          )}
          <Link href={personHrefForOfficial(inc.officialId)} className="inline-flex min-h-11 items-center font-sans text-xs font-semibold text-accent underline">
            Full voting record →
          </Link>
        </div>
      ))}
      <p className="mt-3 font-sans text-[11px] text-ink-45">
        <SourceLink href={e.sourceUrl} className="text-[11px]">Candidate list · {e.sourceLabel}</SourceLink>
        {" · "}Not researched in depth — candidate list only.
      </p>
    </li>
  );
}
