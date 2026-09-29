"use client";

import Link from "next/link";
import { useState } from "react";
import { ISSUES, type GuideRace, type IssueKey } from "@/server/guide/types";
import { Cites, PartyChips } from "./ui";

const TOPIC_LABELS: Record<IssueKey, string> = {
  abortion: "Abortion", guns: "Gun laws", immigration_enforcement: "Immigration",
  rent_regulation: "Rent & tenant protections", housing_supply: "Housing & zoning",
  tax_wealthy: "Taxes", healthcare_public: "Health coverage", climate: "Climate & energy",
  police_funding: "Policing", school_choice: "School choice", congestion_pricing: "Congestion pricing",
  minimum_wage: "Minimum wage", israel_aid: "U.S. aid to Israel", tariffs: "Trade & tariffs",
  universal_childcare: "Child care",
};

/** Topic selection narrows the evidence, never ranks candidates or infers voter beliefs. */
export function Matcher({ races, placeLabel }: { races: GuideRace[]; placeLabel: string }) {
  const [selected, setSelected] = useState<IssueKey[]>([]);
  const [recordsOnly, setRecordsOnly] = useState(false);
  const candidateRaces = races.filter((r) => r.candidates.length > 0);
  const issues = (Object.keys(ISSUES) as IssueKey[]).filter((key) => candidateRaces.some((r) => r.candidates.some((c) => c.positions.some((p) => p.issue === key))));
  const visibleIssues = selected.length ? selected : issues;

  if (!candidateRaces.length) return <p className="mt-6 border border-card p-5 text-sm text-ink-60">We don&rsquo;t have researched candidate races for {placeLabel} yet. <Link href="/issues" className="text-accent underline">Explore our recorded votes</Link>.</p>;

  return <div className="mt-8">
    <section className="border border-card bg-paper-raised p-5 sm:p-6" aria-labelledby="topic-heading">
      <h2 id="topic-heading" className="font-serif text-2xl font-semibold text-ink">Choose the subjects you want to explore.</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-60">Read the same subjects for every candidate. Recorded actions and campaign statements are labeled separately. Your selection filters the evidence; it does not produce a score, ranking, or voting recommendation.</p>
      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Filter candidate evidence by topic">
        {issues.map((key) => <button key={key} type="button" aria-pressed={selected.includes(key)} onClick={() => setSelected((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])} className={`min-h-11 cursor-pointer rounded-full border px-4 py-2 text-sm font-semibold ${selected.includes(key) ? "border-accent bg-accent-tint text-accent-deep" : "border-chip-border text-ink-60 hover:border-accent"}`}>{TOPIC_LABELS[key]}</button>)}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink"><input type="checkbox" checked={recordsOnly} onChange={(e) => setRecordsOnly(e.target.checked)} className="size-4 accent-accent" />Show only evidence based on recorded votes</label>
        {selected.length > 0 && <button type="button" onClick={() => setSelected([])} className="min-h-11 cursor-pointer text-sm text-accent underline">Clear topic filters</button>}
      </div>
      <p className="mt-2 text-xs text-ink-60">Selections stay on this page and are not saved. <Link href="/issues" className="text-accent underline">Explore individual roll calls and motions →</Link></p>
    </section>
    <p className="mt-6 text-sm text-ink-60" role="status">{selected.length ? `${selected.length} selected topics` : "All available topics"} · {candidateRaces.length} researched races · candidates in alphabetical order within each race</p>
    <div className="mt-5 space-y-10">
      {candidateRaces.map((race) => <section key={race.id} aria-labelledby={`race-${race.id}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-card-strong pb-3"><h2 id={`race-${race.id}`} className="font-serif text-2xl font-semibold text-ink">{race.title}</h2><Link href={`/guide/race/${race.id}`} className="text-sm font-semibold text-accent hover:underline">Full race & sources →</Link></div>
        <p className="mt-2 text-xs leading-relaxed text-ink-60">Research dated {race.researchedAt}. Coverage varies by candidate; missing evidence is not a position.</p>
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
          {[...race.candidates].sort((a, b) => a.name.localeCompare(b.name)).map((candidate) => {
            const documented = visibleIssues.filter((key) => candidate.positions.some((p) => p.issue === key && (!recordsOnly || p.basis === "votes"))).length;
            return <article key={candidate.id} className="min-w-0 border border-card bg-paper-raised p-5">
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-serif text-xl font-semibold text-ink"><Link href={`/guide/race/${race.id}/${candidate.id}`} className="hover:underline">{candidate.name}</Link></h3><PartyChips parties={candidate.parties} /></div>
              <p className="mt-2 text-xs text-ink-60">{documented} of {visibleIssues.length} displayed topics with {recordsOnly ? "vote-based" : "documented"} evidence</p>
              <ul className="mt-4 divide-y divide-hairline">
                {visibleIssues.map((key) => {
                  const position = candidate.positions.find((p) => p.issue === key && (!recordsOnly || p.basis === "votes"));
                  return <li key={key} className="py-4 first:pt-0">
                    <h4 className="text-sm font-bold text-ink">{TOPIC_LABELS[key]}</h4>
                    {position ? <>
                      <span className={`mt-2 inline-block rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${position.basis === "votes" ? "border-accent-tint-border bg-accent-tint text-accent-deep" : "border-chip-border bg-canvas text-ink-60"}`}>{position.basis === "votes" ? "Based on recorded votes" : "Documented position"}</span>
                      <p className="mt-2 text-sm leading-relaxed text-ink-80">{position.summary} <Cites ids={position.sources} race={race} /></p>
                      {position.stated && <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-ink-60">Also on record: the candidate&rsquo;s statements</summary><p className="mt-2 text-sm leading-relaxed text-ink-60">{position.stated.summary} <Cites ids={position.stated.sources} race={race} /></p></details>}
                    </> : <p className="mt-2 text-sm leading-relaxed text-ink-60">No {recordsOnly ? "vote-based " : ""}evidence in our research on this topic. This does not establish the candidate&rsquo;s position.</p>}
                  </li>;
                })}
              </ul>
              {visibleIssues.length === 0 && <p className="mt-4 text-sm text-ink-60">No issue evidence is available for these races yet. Open the full profile to inspect available records.</p>}
            </article>;
          })}
        </div>
      </section>)}
    </div>
  </div>;
}
