import { ISSUES, type GuideCandidate, type GuideRace } from "@/server/guide/types";
import { BallotModule, ModHead, MoneyDetails, PartyLineModule, SaidVsDidTable, VoteTable, voteRows } from "./Ledger";
import { CitedText, Cites, IncumbentTag, PartyChips } from "./ui";

const DEPTH_NOTE: Record<GuideCandidate["researchDepth"], string | null> = {
  full: null,
  basic: "Basic profile — the most important sourced facts we found.",
  minimal: "Little public record found for this candidate.",
};

const RECENT_VOTES = 8;

/** Graphite header band: identifiers, name, role, and the race at a glance. */
export function CandidateBand({ race, candidate: c, breadcrumb }: { race: GuideRace; candidate: GuideCandidate; breadcrumb?: React.ReactNode }) {
  const opponents = race.candidates.filter((o) => o.id !== c.id);
  const ids = [c.bioguideId && `BIOGUIDE ${c.bioguideId}`, c.fecId && `FEC ${c.fecId}`].filter(Boolean).join(" · ");
  return (
    <header className="bg-band text-band-ink">
      <div className="mx-auto grid w-full max-w-6xl gap-x-10 gap-y-5 px-4 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-end lg:px-10">
        <div className="min-w-0">
          {breadcrumb && <div className="mb-3 font-sans text-[12.5px] text-band-muted [&_a:hover]:text-band-ink">{breadcrumb}</div>}
          <p className="font-mono text-[12px] tracking-[0.02em] text-band-muted">{ids || race.title}</p>
          <h1 className="mb-2 mt-1.5 text-balance font-sans text-[30px] font-extrabold leading-none tracking-[-0.025em] sm:text-[40px] lg:text-[46px]">{c.name}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-serif text-[17px] leading-snug text-band-muted">
            <b className="font-medium text-band-ink">{c.currentRole ?? (c.incumbent ? "Incumbent" : "Candidate")}</b>
            <span className="inline-flex gap-1 [&>span]:border-band-muted [&>span]:text-band-ink">
              <PartyChips parties={c.parties} />
            </span>
            {c.incumbent && <span className="[&>span]:text-band-muted"><IncumbentTag /></span>}
          </p>
        </div>
        <dl className="grid grid-cols-2 border-t border-band-rule font-sans">
          {[
            { t: "Race", d: race.title },
            { t: "Election", d: race.electionDate },
            { t: opponents.length === 1 ? "Opponent" : "Opponents", d: opponents.length ? opponents.map((o) => `${o.name} (${o.parties.join(", ")})`).join("; ") : "Unopposed" },
            { t: "Research", d: c.researchDepth === "full" ? "In depth" : c.researchDepth === "basic" ? "Basic" : "Minimal record" },
          ].map((x, i) => (
            <div key={x.t} className={`min-w-0 border-b border-band-rule py-2.5 ${i % 2 === 0 ? "pr-3" : ""}`}>
              <dt className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-band-muted">{x.t}</dt>
              <dd className="mt-0.5 text-[14px] font-semibold leading-snug">{x.d}</dd>
            </div>
          ))}
        </dl>
        <nav aria-label="On this page" className="-mb-px flex gap-5 overflow-x-auto font-sans text-[13px] font-semibold lg:col-span-2">
          {[
            ["#overview", "Overview"],
            ["#said-vs-did", "Said vs. did"],
            ["#votes", "Votes"],
            ["#biography", "Biography"],
            ["#money", "Money"],
            ["#sources", "Sources"],
          ].map(([href, label], i) => (
            <a key={href} href={href} className={`whitespace-nowrap border-b-[3px] pb-3 pt-3.5 ${i === 0 ? "border-accent text-band-ink" : "border-transparent text-band-muted hover:text-band-ink"}`}>
              {label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

function Section({ id, title, sub, children }: { id: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-9 scroll-mt-4">
      <h2 className="font-sans text-[22px] font-bold leading-tight tracking-[-0.01em] text-ink">{title}</h2>
      {sub && <p className="mt-1 max-w-[70ch] font-serif text-[15px] leading-[1.45] text-ink-60">{sub}</p>}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

/** The full sourced profile of one candidate, in the Ledger layout. */
export function CandidateProfile({ race, candidate: c }: { race: GuideRace; candidate: GuideCandidate }) {
  const depthNote = DEPTH_NOTE[c.researchDepth];
  const rows = voteRows(c);
  const saidCount = c.positions.filter((p) => (p.basis === "votes" ? p.stated : true)).length;
  const firstQuote = c.positions.find((p) => p.quote || p.stated?.quote);
  return (
    <div>
      <div id="overview" className="mt-6 grid scroll-mt-4 border border-card bg-paper-raised md:grid-cols-3">
        <div className="min-w-0 px-4 py-4 sm:px-5">
          <PartyLineModule c={c} rows={rows} />
        </div>
        <div className="min-w-0 border-t border-card px-4 py-4 sm:px-5 md:border-l md:border-t-0">
          <ModHead title="Said vs. did" note={`${saidCount} statement${saidCount === 1 ? "" : "s"} · ${rows.length} votes`} />
          {firstQuote ? (
            <>
              <q className="block font-serif text-[15px] leading-[1.45] text-ink">{firstQuote.quote ?? firstQuote.stated?.quote}</q>
              <p className="mt-1.5 font-mono text-[11.5px] text-ink-45">{ISSUES[firstQuote.issue]}</p>
            </>
          ) : (
            <p className="font-serif text-[15px] leading-[1.45] text-ink-80">
              <CitedText c={c.summary} race={race} />
            </p>
          )}
          {c.positions.length > 0 && (
            <a href="#said-vs-did" className="mt-2 inline-block font-sans text-[12.5px] font-semibold text-accent underline">
              Compare statements with votes ›
            </a>
          )}
        </div>
        <div className="min-w-0 border-t border-card px-4 py-4 sm:px-5 md:border-l md:border-t-0">
          <BallotModule race={race} c={c} />
        </div>
      </div>

      {c.positions.length > 0 && (
        <Section
          id="said-vs-did"
          title="Said vs. did"
          sub="Each documented position next to the recorded floor votes we map to the same issue. Votes are compared one at a time; no overall stance is inferred from them."
        >
          <SaidVsDidTable race={race} positions={c.positions} />
        </Section>
      )}

      <div className={`grid gap-x-8 ${rows.length ? "lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" : ""}`}>
        <Section id="biography" title="Biography">
          <div className="border border-card bg-paper-raised px-5 py-4">
            <p className="max-w-[64ch] font-serif text-[17.5px] leading-[1.55] text-ink">
              <CitedText c={c.summary} race={race} />
            </p>
            {depthNote && <p className="mt-2 font-sans text-[11.5px] italic text-ink-45">{depthNote}</p>}
            {c.paragraphs.length > 0 && (
              <div className="mt-3 flex flex-col gap-3 border-t border-hairline pt-3 font-sans text-[14px] leading-[1.6] text-ink-80">
                {c.paragraphs.map((para, i) => (
                  <p key={i}>
                    {para.map((b, j) => (
                      <span key={j}>
                        <CitedText c={b} race={race} />{" "}
                      </span>
                    ))}
                  </p>
                ))}
              </div>
            )}
            {c.website && (
              <p className="mt-3 border-t border-hairline pt-2.5 font-sans text-[12.5px]">
                <a href={c.website} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">
                  Campaign website ↗
                </a>
              </p>
            )}
          </div>
        </Section>
        {rows.length > 0 && (
          <Section id="votes" title="Recent votes">
            <VoteTable rows={rows} limit={RECENT_VOTES} compact />
          </Section>
        )}
      </div>
      {!rows.length && <span id="votes" />}

      {rows.length > RECENT_VOTES && (
        <details className="mt-4 border border-card bg-paper-raised">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 font-sans text-[13px] font-semibold text-ink">All {rows.length} recorded votes</summary>
          <div className="border-t border-hairline p-3">
            <VoteTable rows={rows} />
            {(c.stateVotes?.length ?? 0) > 0 && (
              <p className="mt-2 font-sans text-[11.5px] text-ink-45">
                Albany votes: landmark laws since 2019, plus the 25 most recent 2025&ndash;26 roll calls where at least five members voted on the losing side, from the
                legislature&rsquo;s official records. Party line is scored for 2025&ndash;26 votes only.
              </p>
            )}
          </div>
        </details>
      )}

      {c.record.length > 0 && (
        <Section id="record" title="On the record" sub="Official actions: bills, executive acts, filings and court records.">
          <ul className="flex flex-col divide-y divide-hairline border border-card bg-paper-raised">
            {c.record.map((r, i) => (
              <li key={i} className="flex gap-3 px-4 py-2.5 font-sans text-[13.5px] leading-[1.5] text-ink-80">
                <span className="mt-[3px] w-[60px] flex-none rounded-[2px] border border-chip-border px-1 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-60">
                  {r.kind}
                </span>
                <span className="min-w-0">
                  {r.date && <span className="font-mono text-[12px] text-ink-45">{r.date} · </span>}
                  <CitedText c={r} race={race} />
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {((c.statements?.length ?? 0) > 0 || c.priorities.length > 0) && (
        <Section id="own-words" title="In their own words">
          <div className="grid gap-4 md:grid-cols-2">
            {c.priorities.length > 0 && (
              <div className="border border-card bg-paper-raised px-4 py-3">
                <h3 className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-45">Priorities</h3>
                <ul className="flex flex-col gap-2">
                  {c.priorities.map((p, i) => (
                    <li key={i} className="border-l-2 border-accent-tint-border pl-3 font-sans text-[13.5px] leading-[1.55] text-ink-80">
                      <CitedText c={p} race={race} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(c.statements?.length ?? 0) > 0 && (
              <div className="border border-card bg-paper-raised px-4 py-3">
                <h3 className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-45">Statements, quoted without a stance</h3>
                <ul className="flex flex-col gap-3">
                  {c.statements!.map((st, i) => (
                    <li key={`${st.issue}-${i}`} className="font-sans text-[13px] leading-[1.5] text-ink-80">
                      <span className="font-semibold text-ink">{ISSUES[st.issue]}</span>
                      <blockquote className="mt-1 font-serif text-[15px] leading-[1.45] text-ink-80">
                        “{st.quote}”
                        <Cites ids={st.sources} race={race} />
                      </blockquote>
                      {st.context && <p className="mt-0.5 text-[12px] text-ink-45">{st.context}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}

      <section id="money" className="mt-9 scroll-mt-4">
        {c.finance ? (
          <MoneyDetails f={c.finance} />
        ) : (
          <p className="border border-card bg-paper-raised px-4 py-3 font-sans text-[12.5px] text-ink-45">
            <b className="mr-2 font-bold uppercase tracking-[0.06em] text-ink">Campaign money</b>No FEC filing summary matched — state candidates file with their state, not the FEC.
          </p>
        )}
      </section>
    </div>
  );
}
