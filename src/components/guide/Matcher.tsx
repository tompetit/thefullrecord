"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  alignmentRace,
  alphabetical,
  parseStand,
  serializeStand,
  TOPIC_LABELS,
  withStand,
  type Answer,
  type StandEntry,
} from "@/lib/alignment";
import { ISSUES, type GuideRace, type IssueKey } from "@/server/guide/types";
import { AlignmentBreakdown, AlignmentDisclaimer } from "./Alignment";
import { Cites, PartyChips } from "./ui";

const ISSUE_KEYS = Object.keys(ISSUES) as IssueKey[];
/** Per-tab convenience only (cleared when the tab closes); the URL is the source of truth. */
const TAB_KEY = "tfr:stand";

const CHOICES: Array<{ value: Answer | "skip"; label: string }> = [
  { value: "agree", label: "Agree" },
  { value: "disagree", label: "Disagree" },
  { value: "skip", label: "Not sure / skip" },
];

function syncUrl(param: string) {
  const url = withStand(window.location.pathname + window.location.search + window.location.hash, param);
  window.history.replaceState(null, "", url);
  try {
    if (param) sessionStorage.setItem(TAB_KEY, param);
    else sessionStorage.removeItem(TAB_KEY);
  } catch {
    // storage blocked: the URL still carries the answers
  }
}

/**
 * Topic selection narrows the evidence, and "Where I stand" compares the
 * voter's own answers issue by issue. Neither ranks candidates, scores them,
 * weights issues, or recommends a vote.
 */
export function Matcher({ races, placeLabel, initialStand }: { races: GuideRace[]; placeLabel: string; initialStand: StandEntry[] }) {
  const [selected, setSelected] = useState<IssueKey[]>([]);
  const [recordsOnly, setRecordsOnly] = useState(false);
  const [stand, setStand] = useState<StandEntry[]>(initialStand);
  const candidateRaces = races.filter((r) => r.candidates.length > 0);
  const issues = ISSUE_KEYS.filter((key) => candidateRaces.some((r) => r.candidates.some((c) => c.positions.some((p) => p.issue === key))));
  // Offer every documented topic, plus any answered via a shared link.
  const offered = ISSUE_KEYS.filter((key) => issues.includes(key) || stand.some((s) => s.issue === key));
  const visibleIssues = selected.length ? selected : issues;
  const param = serializeStand(stand);

  // Restore this tab's answers after an address change (the address form drops the query).
  useEffect(() => {
    if (initialStand.length) return;
    let saved: StandEntry[] = [];
    try {
      saved = parseStand(sessionStorage.getItem(TAB_KEY), ISSUE_KEYS);
    } catch {
      return;
    }
    if (!saved.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from tab storage after hydration
    setStand(saved);
    syncUrl(serializeStand(saved));
  }, [initialStand]);

  function answer(issue: IssueKey, value: Answer | "skip") {
    const next = parseStand(
      serializeStand([...stand.filter((s) => s.issue !== issue), ...(value === "skip" ? [] : [{ issue, answer: value }])]),
      ISSUE_KEYS,
    );
    setStand(next);
    syncUrl(serializeStand(next));
  }

  function clearAll() {
    setStand([]);
    syncUrl("");
  }

  if (!candidateRaces.length) return <p className="mt-6 border border-card p-5 text-sm text-ink-60">We don&rsquo;t have researched candidate races for {placeLabel} yet. <Link href="/issues" className="text-accent underline">Explore our recorded votes</Link>.</p>;

  return <div className="mt-8">
    <section className="border border-card bg-paper-raised p-4 sm:p-6" aria-labelledby="stand-heading">
      <p className="font-sans text-[11px] font-bold tracking-[0.1em] text-accent">OPTIONAL</p>
      <h2 id="stand-heading" className="mt-1 font-serif text-2xl font-semibold text-ink">Where I stand</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-60">Answer only the statements you want to. For each one you answer, every candidate&rsquo;s documented position is shown beside yours, with its sources. Every answer counts the same; nothing is weighted, scored, or ranked.</p>
      <p className="mt-2 max-w-3xl border-l-2 border-card-strong pl-3 text-[12.5px] leading-relaxed text-ink-60"><b className="text-ink-80">Private and not saved.</b> Your answers stay in this browser tab and in this page&rsquo;s link — we don&rsquo;t store them or connect them to you. Anyone you share the link with will see your answers and the address you entered.</p>
      <div className="mt-4 divide-y divide-hairline border-y border-hairline">
        {offered.map((key) => {
          const current = stand.find((s) => s.issue === key)?.answer ?? "skip";
          return <fieldset key={key} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
            <legend className="sr-only">{TOPIC_LABELS[key]}: {ISSUES[key]}</legend>
            <div aria-hidden className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-45">{TOPIC_LABELS[key]}</p>
              <p className="font-serif text-[16px] leading-snug text-ink">{ISSUES[key]}</p>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:flex">
              {/* A selected skip is the quiet default — it must not read like an answer. */}
              {CHOICES.map((choice) => <label key={choice.value} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md border-[1.5px] border-chip-border px-2 text-center text-[13px] font-semibold leading-tight text-ink-60 hover:border-ink-45 ${choice.value === "skip" ? "has-checked:border-ink-45 has-checked:bg-canvas has-checked:text-ink-80" : "has-checked:border-ink has-checked:bg-ink has-checked:text-paper"} has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent sm:px-3`}>
                <input type="radio" name={`stand-${key}`} value={choice.value} checked={current === choice.value} onChange={() => answer(key, choice.value)} className="sr-only" />
                {choice.value === "agree" && <span aria-hidden className="mr-1">✓</span>}{choice.value === "disagree" && <span aria-hidden className="mr-1">✕</span>}{choice.label}
              </label>)}
            </div>
          </fieldset>;
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-80" role="status">{stand.length ? `${stand.length} answered · ${offered.length - stand.length} skipped` : "No answers yet — all statements skipped."}</p>
        {stand.length > 0 && <button type="button" onClick={clearAll} className="min-h-11 cursor-pointer text-sm text-accent underline">Clear my answers</button>}
      </div>
    </section>

    {stand.length > 0 ? <>
      <AlignmentDisclaimer className="mt-8" />
      <p className="mt-3 text-sm text-ink-60">{stand.length} answered {stand.length === 1 ? "topic" : "topics"} · {candidateRaces.length} researched races · candidates in alphabetical order within each race. Each comparison is labeled by whether it rests on recorded votes or on statements. Clear your answers to browse all evidence by topic instead.</p>
      <div className="mt-5 space-y-10">
        {candidateRaces.map((race) => {
          const slim = alignmentRace(race);
          return <section key={race.id} aria-labelledby={`race-${race.id}`}>
            <RaceHeading race={race} param={param} />
            <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
              {slim.candidates.map((c) => <AlignmentBreakdown key={c.id} race={slim} candidate={c} stand={stand} nameHref={withStand(`/guide/race/${race.id}/${c.id}`, param)} />)}
            </div>
          </section>;
        })}
      </div>
    </> : <>
      <section className="mt-8 border border-card bg-paper-raised p-4 sm:p-6" aria-labelledby="topic-heading">
        <h2 id="topic-heading" className="font-serif text-2xl font-semibold text-ink">Or choose the subjects you want to explore.</h2>
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
          <RaceHeading race={race} param={param} />
          <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
            {alphabetical(race.candidates).map((candidate) => {
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
    </>}
  </div>;
}

function RaceHeading({ race, param }: { race: GuideRace; param: string }) {
  return <>
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-card-strong pb-3"><h2 id={`race-${race.id}`} className="font-serif text-2xl font-semibold text-ink">{race.title}</h2><Link href={withStand(`/guide/race/${race.id}`, param)} className="text-sm font-semibold text-accent hover:underline">Full race & sources →</Link></div>
    <p className="mt-2 text-xs leading-relaxed text-ink-60">Research dated {race.researchedAt}. Coverage varies by candidate; missing evidence is not a position.</p>
  </>;
}
