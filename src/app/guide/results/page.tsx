import Link from "@/components/Link";
import { resultHeadline, updatedLabel } from "@/components/guide/Results";
import { ALL_STATES, stateName } from "@/components/guide/RaceView";
import { OFFICE_LABEL, SectionLabel } from "@/components/guide/ui";
import { getAllRaces } from "@/server/guide/load";
import { getRaceResult } from "@/server/guide/results";
import type { GuideRace } from "@/server/guide/types";

export const metadata = {
  title: "2026 Election Results — The Full Record",
  description: "Projected winners, ballot measure outcomes and uncalled races from the November 3, 2026 election, with sources.",
};

const SUMMARY_OFFICES: GuideRace["officeType"][] = ["us-senate", "us-house", "governor", "attorney-general", "secretary-of-state"];

function winnerParty(race: GuideRace) {
  const r = getRaceResult(race.id);
  return r?.status === "projected" ? race.candidates.find((c) => c.id === r.winner)?.parties[0] : undefined;
}

function RaceList({ races }: { races: GuideRace[] }) {
  return (
    <ul className="mt-3 grid gap-x-8 md:grid-cols-2">
      {races.map((r) => {
        const result = getRaceResult(r.id)!;
        return (
          <li key={r.id} className="flex items-baseline justify-between gap-3 border-b border-hairline-soft py-2 font-sans text-[13.5px]">
            <Link href={`/guide/race/${r.id}`} className="font-semibold text-ink-80 hover:underline">{r.title}</Link>
            <span className="text-right text-[12.5px] text-ink-60">{resultHeadline(r, result)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function ResultsPage() {
  const races = getAllRaces().filter((r) => getRaceResult(r.id));
  const open = races.filter((r) => getRaceResult(r.id)!.status !== "projected");
  const measures = races.filter((r) => r.officeType === "ballot-measure" && getRaceResult(r.id)!.outcome);
  const defeated = races.flatMap((r) => {
    const result = getRaceResult(r.id)!;
    if (result.status !== "projected" || r.officeType === "ballot-measure") return [];
    return r.candidates.filter((c) => c.incumbent && c.id !== result.winner).map((c) => ({ race: r, name: c.name }));
  });
  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 pt-8 lg:px-10">
        <nav aria-label="Breadcrumb" className="font-sans text-[12.5px] text-ink-60">
          <Link href="/guide" className="hover:text-ink">Guide</Link> › Results
        </nav>
        <h1 className="mt-2 font-serif text-[32px] font-semibold tracking-[-0.015em] text-ink lg:text-[44px]">2026 election results</h1>
        <p className="mt-2 max-w-3xl font-sans text-[14px] leading-[1.6] text-ink-60">
          As of {updatedLabel()}. Unofficial until states certify, and counts can still change. <Link href="/guide/methodology#results" className="underline">Where these come from</Link>
        </p>

        <section className="mt-8">
          <SectionLabel>Projected winners by party</SectionLabel>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border border-card bg-paper-raised font-sans text-[13.5px] text-ink-80">
              <thead>
                <tr className="text-left text-[11px] font-bold tracking-[0.04em] text-ink-60">
                  <th scope="col" className="p-2.5">Office</th>
                  <th scope="col" className="p-2.5 text-right">Democratic</th>
                  <th scope="col" className="p-2.5 text-right">Republican</th>
                  <th scope="col" className="p-2.5 text-right">Other</th>
                  <th scope="col" className="p-2.5 text-right">No call yet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-soft">
                {SUMMARY_OFFICES.map((o) => {
                  const list = races.filter((r) => r.officeType === o);
                  const parties = list.map(winnerParty);
                  // Files use both "D" and "Democratic", and DFL counts as Democratic.
                  const d = parties.filter((p) => p?.startsWith("D")).length;
                  const g = parties.filter((p) => p?.startsWith("R")).length;
                  const none = parties.filter((p) => !p).length;
                  return (
                    <tr key={o}>
                      <th scope="row" className="p-2.5 text-left font-semibold">{OFFICE_LABEL[o]}</th>
                      <td className="p-2.5 text-right font-mono">{d}</td>
                      <td className="p-2.5 text-right font-mono">{g}</td>
                      <td className="p-2.5 text-right font-mono">{list.length - d - g - none}</td>
                      <td className="p-2.5 text-right font-mono">{none}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {open.length > 0 && (
          <section className="mt-10">
            <SectionLabel>Not yet decided · {open.length}</SectionLabel>
            <RaceList races={open} />
          </section>
        )}

        {defeated.length > 0 && (
          <section className="mt-10">
            <SectionLabel>Incumbents projected to lose · {defeated.length}</SectionLabel>
            <ul className="mt-3 grid gap-x-8 md:grid-cols-2">
              {defeated.map(({ race, name }) => (
                <li key={`${race.id}-${name}`} className="flex items-baseline justify-between gap-3 border-b border-hairline-soft py-2 font-sans text-[13.5px]">
                  <span className="font-semibold text-ink-80">{name}</span>
                  <Link href={`/guide/race/${race.id}`} className="text-right text-[12.5px] text-ink-60 hover:underline">{race.title}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {measures.length > 0 && (
          <section className="mt-10">
            <SectionLabel>Ballot measures · {measures.length}</SectionLabel>
            <RaceList races={measures} />
          </section>
        )}

        <section className="mt-10">
          <SectionLabel>Every race, state by state</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-5">
            {ALL_STATES.map((st) => (
              <Link key={st} href={`/guide/state/${st.toLowerCase()}`} className="rounded-[2px] border border-hairline-soft bg-paper-raised px-3 py-2 font-sans text-[13px] font-semibold text-ink-80 hover:border-card-strong">
                {stateName(st)}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
