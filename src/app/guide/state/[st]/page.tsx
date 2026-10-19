import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { ALL_STATES, stateName } from "@/components/guide/RaceView";
import { IncumbentTag, OFFICE_LABEL, PartyChips, SectionLabel } from "@/components/guide/ui";
import { SourceLink } from "@/components/SourceLink";
import { chamberLabel } from "@/lib/issues";
import { getAllRaces } from "@/server/guide/load";
import { chamberName } from "@/lib/usStates";
import { stateSlateStats } from "@/server/live/elections";
import { daysAgo, topContested } from "@/server/issues";
import type { GuideRace } from "@/server/guide/types";

// The 12-month window moves; rebuild daily.
export const revalidate = 86400;

export function generateStaticParams() {
  return ALL_STATES.map((st) => ({ st: st.toLowerCase() }));
}

export async function generateMetadata({ params }: { params: Promise<{ st: string }> }): Promise<Metadata> {
  const { st } = await params;
  return { title: `${stateName(st.toUpperCase())} 2026 races — The Full Record` };
}

export default async function StatePage({ params }: { params: Promise<{ st: string }> }) {
  const st = (await params).st.toUpperCase();
  if (!ALL_STATES.includes(st)) notFound();
  const races = getAllRaces().filter((r) => r.state === st);
  const since = daysAgo(365);
  const contested = topContested((r) => r.state === st.toLowerCase() && r.chamber !== "NYC COUNCIL" && r.date >= since, 5);
  const slates = stateSlateStats(st);
  const legSeats = [
    slates.upper && `${slates.upper} ${chamberName(st, "upper")}`,
    slates.legislature && `${slates.legislature} ${chamberName(st, "legislature")}`,
    slates.lower && `${slates.lower} ${chamberName(st, "lower")}`,
  ].filter(Boolean);
  const groups = new Map<string, GuideRace[]>();
  for (const r of races) {
    const k = OFFICE_LABEL[r.officeType];
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 pt-6 lg:px-10">
        <nav aria-label="Breadcrumb" className="font-sans text-[12.5px] text-ink-60">
          <Link href="/guide" className="hover:text-ink">Guide</Link> › {stateName(st)}
        </nav>
        <h1 className="mt-2 font-serif text-[32px] font-semibold tracking-[-0.015em] text-ink lg:text-[44px]">
          {stateName(st)} · 2026
        </h1>
        <p className="mt-1 font-sans text-[14px] text-ink-60">
          {races.length} races researched for the November 3 general election.
        </p>
        {!races.length && (
          <p className="mt-6 rounded-lg border border-hairline-soft bg-paper-raised p-4 font-sans text-[13.5px] text-ink-60">
            Research for {stateName(st)} is in progress.
          </p>
        )}
        {contested.length > 0 && <section aria-labelledby="contested-state" className="mt-8">
          <h2 id="contested-state" className="font-serif text-[22px] font-semibold text-ink">Most contested votes in the {stateName(st)} Legislature</h2>
          <p className="mt-1 font-sans text-[13px] text-ink-60">Roll calls from the last 12 months, ranked by how close the vote was and how far apart the parties voted. <Link href="/coverage#party-splits" className="underline">How we rank</Link></p>
          <ul className="mt-3 divide-y divide-hairline-soft rounded-lg border border-card bg-paper-raised px-4">
            {contested.map((r) => (
              <li key={r.id} className="py-3">
                <p className="font-serif text-[16px] font-bold leading-snug text-ink"><Link href={r.href} className="hover:underline">{r.title}</Link></p>
                <p className="mt-1 font-sans text-xs text-ink-60">{chamberLabel(r.chamber)} · {r.outcome} · Yes {r.tally[0]} · No {r.tally[1]} · {r.dateLabel}</p>
                <span className="inline-flex min-h-11 items-center font-sans text-xs"><SourceLink href={r.sourceUrl}>Official record</SourceLink></span>
              </li>
            ))}
          </ul>
          <Link href={`/votes?state=${st.toLowerCase()}`} className="inline-flex min-h-11 items-center font-sans text-[13px] font-semibold text-accent underline">See all contested votes in {stateName(st)} →</Link>
        </section>}
        {legSeats.length > 0 && <section aria-labelledby="state-leg" className="mt-8">
          <h2 id="state-leg" className="font-serif text-[22px] font-semibold text-ink">State legislative races on the ballot</h2>
          <p className="mt-1 max-w-3xl font-sans text-[13px] leading-[1.6] text-ink-60">
            Seats up on November 3: {legSeats.join(", ")}. We list the candidates for each, without in-depth research. <Link href="/guide/ballot" className="underline">Enter your address on the ballot page</Link> to see yours.
          </p>
        </section>}
        {[...groups.entries()].map(([label, list]) => (
          <section key={label} className="mt-8">
            <SectionLabel>{label}</SectionLabel>
            <ul className="mt-3 grid gap-2.5 md:grid-cols-2">
              {list.map((r) => (
                <li key={r.id} className="rounded-lg border border-card bg-paper-raised p-3.5 hover:border-card-strong">
                  <Link href={`/guide/race/${r.id}`} className="font-serif text-[16px] font-bold text-ink hover:underline">
                    {r.title}
                  </Link>
                  <p className="line-clamp-1 font-sans text-[12px] text-ink-45">{r.area}</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {r.candidates.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-1.5 font-sans text-[12.5px] text-ink-80">
                        <Link href={`/guide/race/${r.id}/${c.id}`} className="font-semibold hover:underline">{c.name}</Link>
                        <PartyChips parties={c.parties} />
                        {c.incumbent && <IncumbentTag />}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
