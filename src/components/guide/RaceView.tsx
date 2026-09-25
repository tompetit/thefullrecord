import Link from "next/link";
import { getKeyVoteDefs, getVerification } from "@/server/guide/load";
import { ISSUES, type GuideRace, type IssueKey } from "@/server/guide/types";
import { CandidateProfile, FinanceLine } from "./CandidateProfile";
import {
  CitedText,
  Cites,
  IncumbentTag,
  Monogram,
  OFFICE_LABEL,
  PartyChips,
  SectionLabel,
  SourceList,
  StanceChip,
} from "./ui";

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
};
export const stateName = (st: string) => STATE_NAMES[st.toUpperCase()] ?? st;
export const ALL_STATES = Object.keys(STATE_NAMES);

function Comparison({ race }: { race: GuideRace }) {
  const issues = (Object.keys(ISSUES) as IssueKey[]).filter((k) =>
    race.candidates.some((c) => c.positions.some((p) => p.issue === k))
  );
  if (!issues.length || race.candidates.length < 1) return null;
  return (
    <section className="mt-10">
      <SectionLabel>Where they stand — side by side</SectionLabel>
      <p className="mt-1 font-sans text-[12.5px] text-ink-60">
        Only positions documented in a cited source are shown. Where an
        officeholder&rsquo;s recorded votes speak to an issue, the votes set the position
        (marked &ldquo;votes&rdquo;). A dash means we
        found no clear public position — not that the candidate has none.
      </p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-card bg-paper-raised">
        <table className="w-full min-w-[560px] border-collapse font-sans text-[12.5px]">
          <thead>
            <tr className="border-b border-card">
              <th className="sticky left-0 z-10 w-[200px] bg-paper-raised p-2.5 text-left text-[11px] font-bold tracking-[0.05em] text-ink-45">
                ISSUE
              </th>
              {race.candidates.map((c) => (
                <th key={c.id} className="p-2.5 text-left align-bottom">
                  <a href={`#${c.id}`} className="font-serif text-[14px] font-bold text-ink hover:underline">
                    {c.name}
                  </a>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    <PartyChips parties={c.parties} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {issues.map((k) => (
              <tr key={k} className="border-b border-hairline-soft last:border-0">
                <th scope="row" className="sticky left-0 z-10 bg-paper-raised p-2.5 text-left align-top text-[12.5px] font-semibold text-ink-80">
                  {ISSUES[k]}
                </th>
                {race.candidates.map((c) => {
                  const p = c.positions.find((x) => x.issue === k);
                  return (
                    <td key={c.id} className="p-2.5 align-top" title={p?.summary}>
                      {p ? (
                        <span className="inline-flex items-center">
                          <StanceChip stance={p.stance} />
                          <Cites ids={p.sources} race={race} />
                          {p.basis === "votes" && (
                            <span className="ml-1 font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-45">
                              votes{p.stated && p.stated.stance !== p.stance ? " · says otherwise" : ""}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-ink-35">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function KeyVoteComparison({ race }: { race: GuideRace }) {
  const voters = race.candidates.filter((c) => c.keyVotes?.length);
  if (voters.length < 2) return null;
  const defs = getKeyVoteDefs().filter((d) => voters.some((c) => c.keyVotes!.some((k) => k.voteId === d.id)));
  const word = (v?: string) => (v === "yes" ? "Yes" : v === "no" ? "No" : v === "present" ? "Present" : v ? "—" : "");
  return (
    <section className="mt-10">
      <SectionLabel>Key votes in Congress — side by side</SectionLabel>
      <div className="mt-3 overflow-x-auto rounded-lg border border-card bg-paper-raised">
        <table className="w-full min-w-[520px] border-collapse font-sans text-[12.5px]">
          <thead>
            <tr className="border-b border-card">
              <th className="p-2.5 text-left text-[11px] font-bold tracking-[0.05em] text-ink-45">VOTE</th>
              {voters.map((c) => (
                <th key={c.id} className="p-2.5 text-left font-serif text-[14px] font-bold text-ink">{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {defs.map((d) => (
              <tr key={d.id} className="border-b border-hairline-soft last:border-0">
                <td className="p-2.5 align-top">
                  <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink-80 hover:underline">
                    {d.shortTitle} ↗
                  </a>
                  <div className="text-[11.5px] text-ink-45">{d.chamber === "house" ? "House" : "Senate"} · {d.date}</div>
                </td>
                {voters.map((c) => (
                  <td key={c.id} className="p-2.5 align-top font-serif font-bold text-ink-80">
                    {word(c.keyVotes!.find((k) => k.voteId === d.id)?.vote)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MeasureView({ race }: { race: GuideRace }) {
  const m = race.measure!;
  return (
    <section className="mt-8 flex flex-col gap-6">
      <div className="rounded-xl border border-card bg-paper-raised p-5">
        <SectionLabel>The question on the ballot</SectionLabel>
        <p className="mt-2 font-serif text-[17px] leading-[1.55] text-ink">
          <CitedText c={m.question} race={race} />
        </p>
        <p className="mt-4 font-sans text-[14px] leading-[1.6] text-ink-80">
          <CitedText c={m.summary} race={race} />
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border-[1.5px] border-accent-tint-border bg-accent-tint p-4">
          <h3 className="font-serif text-[18px] font-bold text-accent-deep">A YES vote means</h3>
          <p className="mt-1.5 font-sans text-[13.5px] leading-[1.55] text-ink-80">{m.yesMeans}</p>
        </div>
        <div className="rounded-xl border-[1.5px] border-umber-tint-border bg-umber-tint p-4">
          <h3 className="font-serif text-[18px] font-bold text-umber-deep">A NO vote means</h3>
          <p className="mt-1.5 font-sans text-[13.5px] leading-[1.55] text-ink-80">{m.noMeans}</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {([["Arguments made for", m.argumentsFor], ["Arguments made against", m.argumentsAgainst]] as const).map(
          ([label, list]) => (
            <div key={label}>
              <SectionLabel>{label}</SectionLabel>
              <ul className="mt-2 flex flex-col gap-2">
                {list.map((a, i) => (
                  <li key={i} className="border-l-2 border-card-strong pl-3 font-sans text-[13.5px] leading-[1.55] text-ink-80">
                    <CitedText c={a} race={race} />
                  </li>
                ))}
                {!list.length && <li className="font-sans text-[13px] text-ink-45">None found in public sources.</li>}
              </ul>
            </div>
          )
        )}
      </div>
    </section>
  );
}

function VerificationNote({ raceId }: { raceId: string }) {
  const v = getVerification(raceId);
  if (!v) return null;
  return (
    <details className="mt-3 max-w-3xl rounded-lg border border-accent-tint-border bg-accent-tint px-3.5 py-2 font-sans text-[12.5px] text-accent-deep">
      <summary className="cursor-pointer font-semibold">
        ✓ Fact-checked {v.checkedAt}: {v.claimsChecked} claims re-checked against their sources
        {v.corrected || v.removed ? ` · ${v.corrected} corrected · ${v.removed} removed` : ""}
      </summary>
      <p className="mt-1.5 text-ink-60">
        A second, independent research pass re-opened every cited source for this race and
        corrected or removed anything the source didn&rsquo;t support.
      </p>
      {v.notes.length > 0 && (
        <ul className="mt-1.5 list-disc pl-5 text-ink-60">
          {v.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function RaceView({ race }: { race: GuideRace }) {
  const isMeasure = race.officeType === "ballot-measure";
  return (
    <div className="mx-auto w-full max-w-6xl px-[20px] pt-6 lg:px-10">
      <nav className="font-sans text-[12.5px] text-ink-60">
        <Link href="/guide" className="hover:text-ink">Guide</Link> ›{" "}
        <Link href={`/guide/state/${race.state.toLowerCase()}`} className="hover:text-ink">
          {stateName(race.state)}
        </Link>{" "}
        › {OFFICE_LABEL[race.officeType]}
      </nav>
      <h1 className="mt-2 font-serif text-[28px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink text-pretty lg:text-[40px]">
        {race.title}
      </h1>
      <p className="mt-2 max-w-3xl font-sans text-[14px] leading-[1.6] text-ink-60">{race.area}</p>
      <p className="mt-1 font-sans text-[12.5px] font-semibold text-ink-80">
        General election · Tuesday, November 3, 2026
      </p>
      <VerificationNote raceId={race.id} />

      {race.context.length > 0 && (
        <ul className="mt-5 flex max-w-3xl flex-col gap-1.5 rounded-lg border border-hairline-soft bg-paper-raised p-4 font-sans text-[13.5px] leading-[1.55] text-ink-80">
          {race.context.map((c, i) => (
            <li key={i}>
              <CitedText c={c} race={race} />
            </li>
          ))}
        </ul>
      )}

      {isMeasure ? (
        <MeasureView race={race} />
      ) : (
        <>
          <section className="mt-8">
            <SectionLabel>On the ballot · {race.candidates.length} {race.candidates.length === 1 ? "candidate" : "candidates"}</SectionLabel>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {race.candidates.map((c) => (
                <a
                  key={c.id}
                  href={`#${c.id}`}
                  className="flex items-start gap-3 rounded-lg border border-card bg-paper-raised p-3.5 hover:border-card-strong"
                >
                  <Monogram name={c.name} />
                  <span className="min-w-0">
                    <span className="block font-serif text-[17px] font-bold leading-tight text-ink">{c.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      <PartyChips parties={c.parties} />
                      {c.incumbent && <IncumbentTag />}
                    </span>
                    {c.currentRole && (
                      <span className="mt-1 block font-sans text-[12px] leading-snug text-ink-60">{c.currentRole}</span>
                    )}
                    {c.finance && (
                      <span className="mt-1 block font-sans text-[11.5px] text-ink-45">
                        <FinanceLine candidate={c} />
                      </span>
                    )}
                  </span>
                </a>
              ))}
              {!race.candidates.length && (
                <p className="font-sans text-[13px] text-ink-60">No candidates verified for this seat yet.</p>
              )}
            </div>
          </section>

          <Comparison race={race} />
          <KeyVoteComparison race={race} />

          <section className="mt-10">
            <SectionLabel>The candidates, in full</SectionLabel>
            <div className="mt-3 flex flex-col gap-5">
              {race.candidates.map((c) => (
                <CandidateProfile key={c.id} race={race} candidate={c} showProfileLink />
              ))}
            </div>
          </section>
        </>
      )}

      {race.researchNotes && (
        <section className="mt-10 max-w-3xl">
          <SectionLabel>Research notes & limits</SectionLabel>
          <p className="mt-2 font-sans text-[13px] leading-[1.6] text-ink-60">{race.researchNotes}</p>
        </section>
      )}

      <section className="mt-10" id="sources">
        <SectionLabel>Sources · {race.sources.length}</SectionLabel>
        <p className="mt-1 font-sans text-[12px] text-ink-45">
          Researched {race.researchedAt}. Green citations are official government records.
        </p>
        <div className="mt-3">
          <SourceList race={race} />
        </div>
      </section>
    </div>
  );
}
