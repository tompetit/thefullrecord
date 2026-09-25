"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ISSUES, type GuideRace, type IssueKey, type Stance } from "@/server/guide/types";

type View = "agree" | "disagree";
interface Answer {
  view: View;
  important: boolean;
}
type Answers = Partial<Record<IssueKey, Answer>>;

const STORE = "tfr-match-answers";

function loadAnswers(): Answers {
  try {
    return JSON.parse(window.localStorage.getItem(STORE) ?? "{}") as Answers;
  } catch {
    return {};
  }
}

function agreement(view: View, stance: Stance): number {
  if (stance === "mixed") return 0.5;
  return (view === "agree") === (stance === "supports") ? 1 : 0;
}

interface Score {
  candidateId: string;
  matched: number;
  weight: number;
  documented: number;
  answeredTotal: number;
}

function scoreCandidate(c: GuideRace["candidates"][number], answers: Answers): Score {
  let matched = 0;
  let weight = 0;
  let documented = 0;
  let answeredTotal = 0;
  for (const [issue, a] of Object.entries(answers) as Array<[IssueKey, Answer]>) {
    answeredTotal++;
    const p = c.positions.find((x) => x.issue === issue);
    if (!p) continue;
    documented++;
    const w = a.important ? 2 : 1;
    weight += w;
    matched += w * agreement(a.view, p.stance);
  }
  return { candidateId: c.id, matched, weight, documented, answeredTotal };
}

const VIEW_LABEL: Record<View, string> = { agree: "You agree", disagree: "You disagree" };
const STANCE_LABEL: Record<Stance, string> = { supports: "Supports", opposes: "Opposes", mixed: "Mixed" };

export function Matcher({ races, placeLabel }: { races: GuideRace[]; placeLabel: string }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate saved answers after mount
    setAnswers(loadAnswers());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORE, JSON.stringify(answers));
    } catch {
      // storage unavailable — answers just won't persist
    }
  }, [answers, loaded]);

  const candidateRaces = races.filter((r) => r.candidates.length > 0);
  const issueCoverage = useMemo(() => {
    const counts = new Map<IssueKey, number>();
    for (const r of candidateRaces)
      for (const c of r.candidates) for (const p of c.positions) counts.set(p.issue, (counts.get(p.issue) ?? 0) + 1);
    return counts;
  }, [candidateRaces]);
  const issues = (Object.keys(ISSUES) as IssueKey[])
    .filter((k) => issueCoverage.has(k))
    .sort((a, b) => (issueCoverage.get(b) ?? 0) - (issueCoverage.get(a) ?? 0));

  const answeredCount = Object.keys(answers).length;

  function setView(k: IssueKey, view: View | null) {
    setAnswers((prev) => {
      const next = { ...prev };
      if (view === null || prev[k]?.view === view) delete next[k];
      else next[k] = { view, important: prev[k]?.important ?? false };
      return next;
    });
  }
  function toggleImportant(k: IssueKey) {
    setAnswers((prev) => (prev[k] ? { ...prev, [k]: { ...prev[k]!, important: !prev[k]!.important } } : prev));
  }

  if (!candidateRaces.length) {
    return (
      <p className="mt-6 rounded-lg border border-hairline-soft bg-paper-raised p-4 font-sans text-[13.5px] text-ink-60">
        We don&rsquo;t have researched candidate races for {placeLabel} yet.
      </p>
    );
  }

  return (
    <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {/* Step 1: the voter's views */}
      <section>
        <h2 className="font-serif text-[22px] font-bold text-ink">1. Where do you stand?</h2>
        <p className="mt-1 font-sans text-[13px] leading-[1.55] text-ink-60">
          Answer only what you care about. Tap ★ for issues that matter most —
          they count double. Only issues where a candidate on your ballot has a
          documented position are listed.
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          {issues.map((k) => {
            const a = answers[k];
            return (
              <li key={k} className={`rounded-lg border bg-paper-raised p-3 ${a ? "border-card-strong" : "border-card"}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-sans text-[14px] font-semibold leading-snug text-ink">{ISSUES[k]}</span>
                  <button
                    onClick={() => toggleImportant(k)}
                    disabled={!a}
                    aria-pressed={a?.important ?? false}
                    title="Matters a lot to me (counts double)"
                    className={`flex-none cursor-pointer rounded px-1.5 text-[16px] leading-none disabled:cursor-default disabled:opacity-25 ${
                      a?.important ? "text-sand" : "text-ink-35 hover:text-ink-60"
                    }`}
                  >
                    ★
                  </button>
                </div>
                <div className="mt-2 flex gap-1.5">
                  {(["agree", "disagree"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(k, v)}
                      aria-pressed={a?.view === v}
                      className={`flex-1 cursor-pointer rounded-md border-[1.5px] py-1.5 font-sans text-[12.5px] font-bold ${
                        a?.view === v
                          ? v === "agree"
                            ? "border-accent bg-accent-tint text-accent-deep"
                            : "border-umber bg-umber-tint text-umber-deep"
                          : "border-chip-border text-ink-60 hover:border-card-strong"
                      }`}
                    >
                      {v === "agree" ? "Agree" : "Disagree"}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        {answeredCount > 0 && (
          <button onClick={() => setAnswers({})} className="mt-3 cursor-pointer font-sans text-[12.5px] text-ink-60 underline">
            Clear my answers
          </button>
        )}
      </section>

      {/* Step 2: the candidates, compared to those views */}
      <section>
        <h2 className="font-serif text-[22px] font-bold text-ink">2. How your candidates compare</h2>
        <p className="mt-1 font-sans text-[13px] leading-[1.55] text-ink-60">
          This is not a recommendation. It compares your answers only with
          positions we could document from a cited source. A candidate&rsquo;s
          silence on an issue counts neither for nor against them — and a vote
          is about more than issue positions.
        </p>
        {answeredCount === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-dash-border p-5 font-sans text-[13.5px] text-ink-60">
            Answer a few questions to see how the candidates on your ballot line up.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {candidateRaces.map((r) => {
              const scored = r.candidates
                .map((c) => ({ c, s: scoreCandidate(c, answers) }))
                .sort((a, b) => {
                  const pa = a.s.weight ? a.s.matched / a.s.weight : -1;
                  const pb = b.s.weight ? b.s.matched / b.s.weight : -1;
                  return pb - pa || b.s.documented - a.s.documented;
                });
              return (
                <article key={r.id} className="rounded-xl border border-card bg-paper-raised p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-serif text-[17px] font-bold text-ink">{r.title}</h3>
                    <Link href={`/guide/race/${r.id}`} className="whitespace-nowrap font-sans text-[12px] font-semibold text-accent">
                      Full records →
                    </Link>
                  </div>
                  <ul className="mt-3 flex flex-col gap-3">
                    {scored.map(({ c, s }) => {
                      const pct = s.weight ? Math.round((100 * s.matched) / s.weight) : null;
                      return (
                        <li key={c.id} className="border-t border-hairline-soft pt-3 first:border-0 first:pt-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-serif text-[16px] font-bold text-ink">{c.name}</span>
                            {c.parties.map((p) => (
                              <span key={p} className="rounded-[3px] border border-chip-border px-1 font-sans text-[10.5px] font-semibold">
                                {p}
                              </span>
                            ))}
                          </div>
                          {pct === null ? (
                            <p className="mt-1 font-sans text-[12.5px] text-ink-45">
                              No documented positions on the issues you answered.
                            </p>
                          ) : (
                            <>
                              <div className="mt-1.5 flex items-center gap-2">
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-hairline" aria-hidden>
                                  <div
                                    className={`h-full rounded-full ${s.documented < 3 ? "bg-accent-soft opacity-50" : "bg-accent"}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="w-12 text-right font-sans text-[12.5px] font-bold text-ink-80">{pct}%</span>
                              </div>
                              <p className="mt-1 font-sans text-[12px] text-ink-60">
                                Agrees with you on {Number.isInteger(s.matched) ? s.matched : s.matched.toFixed(1)} of {s.weight} weighted
                                points · position on record for {s.documented} of your {s.answeredTotal} issues
                              </p>
                              {s.documented < 3 && (
                                <p className="mt-0.5 font-sans text-[11.5px] italic text-umber-deep">
                                  Based on only {s.documented} documented {s.documented === 1 ? "position" : "positions"} — read the evidence before drawing conclusions.
                                </p>
                              )}
                              <details className="mt-1.5">
                                <summary className="cursor-pointer font-sans text-[12px] font-semibold text-ink-80">
                                  See the evidence
                                </summary>
                                <ul className="mt-2 flex flex-col gap-2">
                                  {(Object.entries(answers) as Array<[IssueKey, Answer]>).map(([k, a]) => {
                                    const p = c.positions.find((x) => x.issue === k);
                                    return (
                                      <li key={k} className="font-sans text-[12.5px] leading-[1.5] text-ink-80">
                                        <span className="font-semibold">{ISSUES[k]}</span>{" "}
                                        <span className="text-ink-45">
                                          · {VIEW_LABEL[a.view]}
                                          {a.important ? " ★" : ""} · {p ? STANCE_LABEL[p.stance] : "No position on record"}
                                        </span>
                                        {p && (
                                          <span className="block text-ink-60">
                                            {p.summary}{" "}
                                            {p.sources.map((sid) => {
                                              const src = r.sources.find((x) => x.id === sid);
                                              return src ? (
                                                <a
                                                  key={sid}
                                                  href={src.url}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="mr-1 whitespace-nowrap font-semibold text-accent"
                                                >
                                                  {src.publisher} ↗
                                                </a>
                                              ) : null;
                                            })}
                                          </span>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </details>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </article>
              );
            })}
          </div>
        )}
        {races.some((r) => r.officeType === "ballot-measure") && (
          <div className="mt-6">
            <h3 className="font-sans text-[11px] font-bold tracking-[0.08em] text-ink-45">ALSO ON YOUR BALLOT</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {races
                .filter((r) => r.officeType === "ballot-measure")
                .map((r) => (
                  <li key={r.id}>
                    <Link href={`/guide/race/${r.id}`} className="font-sans text-[13px] font-semibold text-ink-80 underline decoration-hairline hover:decoration-ink">
                      {r.title}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
