import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ALL_STATES, stateName } from "@/components/guide/RaceView";
import { GuideFooter, GuideNav, IncumbentTag, OFFICE_LABEL, PartyChips, SectionLabel } from "@/components/guide/ui";
import { getAllRaces } from "@/server/guide/load";
import type { GuideRace } from "@/server/guide/types";

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
  const groups = new Map<string, GuideRace[]>();
  for (const r of races) {
    const k = OFFICE_LABEL[r.officeType];
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return (
    <main className="flex-1">
      <GuideNav active="guide" />
      <div className="mx-auto w-full max-w-6xl px-[20px] pt-6 lg:px-10">
        <nav className="font-sans text-[12.5px] text-ink-60">
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
      <GuideFooter />
    </main>
  );
}
