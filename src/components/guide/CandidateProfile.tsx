import Link from "next/link";
import { getKeyVoteDefs } from "@/server/guide/load";
import { ISSUES, type GuideCandidate, type GuideRace } from "@/server/guide/types";
import {
  CitedText,
  Cites,
  IncumbentTag,
  Monogram,
  PartyChips,
  StanceChip,
  money,
} from "./ui";

const DEPTH_NOTE: Record<GuideCandidate["researchDepth"], string | null> = {
  full: null,
  basic: "Basic profile — the most important sourced facts we found.",
  minimal: "Little public record found for this candidate.",
};

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h4 className="font-sans text-[11px] font-bold tracking-[0.07em] text-ink-45 uppercase">
        {title}
      </h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const VOTE_WORD: Record<string, { w: string; cls: string }> = {
  yes: { w: "Yes", cls: "border-accent bg-accent-tint text-accent-deep" },
  no: { w: "No", cls: "border-umber bg-umber-tint text-umber-deep" },
  present: { w: "Present", cls: "border-dash-border border-dashed text-ink-60" },
  "not voting": { w: "Didn't vote", cls: "border-dash-border border-dashed text-ink-45" },
};

export function KeyVoteList({ candidate }: { candidate: GuideCandidate }) {
  const defs = new Map(getKeyVoteDefs().map((d) => [d.id, d]));
  const rows = (candidate.keyVotes ?? [])
    .map((kv) => ({ kv, def: defs.get(kv.voteId) }))
    .filter((r) => r.def)
    .sort((a, b) => b.def!.date.localeCompare(a.def!.date));
  if (!rows.length) return null;
  return (
    <ul className="flex flex-col divide-y divide-hairline-soft rounded-lg border border-card bg-paper-raised">
      {rows.map(({ kv, def }) => {
        const v = VOTE_WORD[kv.vote] ?? VOTE_WORD["not voting"];
        return (
          <li key={kv.voteId} className="flex items-start gap-3 px-3 py-2.5">
            <span
              className={`mt-0.5 w-[74px] flex-none rounded-md border-[1.5px] px-1.5 py-0.5 text-center font-serif text-[12.5px] font-black ${v.cls}`}
            >
              {v.w}
            </span>
            <span className="min-w-0 font-sans text-[12.5px] leading-snug text-ink-80">
              <span className="font-semibold text-ink">{def!.shortTitle}</span>{" "}
              <span className="text-ink-45">
                · {def!.bill} · {def!.result} {def!.yea}–{def!.nay} ·{" "}
                {def!.date}
              </span>{" "}
              <a
                href={def!.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap font-semibold text-accent"
                title="Official roll call"
              >
                roll call ↗
              </a>
              <span className="mt-0.5 block text-[12px] text-ink-60">{def!.summary}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function StateVoteList({ candidate }: { candidate: GuideCandidate }) {
  const rows = [...(candidate.stateVotes ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  if (!rows.length) return null;
  const word = { yes: "yes", no: "no", absent: "not voting" } as const;
  return (
    <ul className="flex flex-col divide-y divide-hairline-soft rounded-lg border border-card bg-paper-raised">
      {rows.map((r) => {
        const v = VOTE_WORD[word[r.vote]] ?? VOTE_WORD["not voting"];
        return (
          <li key={r.chamber + r.bill + r.date} className="flex items-start gap-3 px-3 py-2.5">
            <span className={`mt-0.5 w-[74px] flex-none rounded-md border-[1.5px] px-1.5 py-0.5 text-center font-serif text-[12.5px] font-black ${v.cls}`}>
              {v.w}
            </span>
            <span className="min-w-0 font-sans text-[12.5px] leading-snug text-ink-80">
              <span className="font-semibold text-ink">{r.title}</span>{" "}
              <span className="text-ink-45">
                · {r.bill} · {r.outcome} · {r.date}
              </span>{" "}
              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-semibold text-accent">
                official record ↗
              </a>
              {r.summary && <span className="mt-0.5 block text-[12px] text-ink-60">{r.summary}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function FinanceLine({ candidate }: { candidate: GuideCandidate }) {
  const f = candidate.finance;
  if (!f) return null;
  return (
    <p className="font-sans text-[12.5px] text-ink-80">
      Raised <b>{money(f.receipts)}</b> · spent <b>{money(f.disbursements)}</b> ·{" "}
      <b>{money(f.cashOnHand)}</b> cash on hand{" "}
      <span className="text-ink-45">(through {f.asOf})</span>{" "}
      <a
        href={f.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="whitespace-nowrap font-semibold text-accent"
      >
        FEC filing ↗
      </a>
    </p>
  );
}

/** The full sourced profile of one candidate. */
const STANCE_WORD = { supports: "supports", opposes: "opposes", mixed: "mixed" } as const;

export function CandidateProfile({
  race,
  candidate: c,
  headingLevel = "h3",
  showProfileLink = false,
}: {
  race: GuideRace;
  candidate: GuideCandidate;
  headingLevel?: "h1" | "h3";
  showProfileLink?: boolean;
}) {
  const H = headingLevel;
  const depthNote = DEPTH_NOTE[c.researchDepth];
  return (
    <article id={c.id} className="scroll-mt-4 rounded-xl border border-card bg-paper-raised p-4 shadow-card lg:p-6">
      <div className="flex items-start gap-3.5">
        <Monogram name={c.name} size={headingLevel === "h1" ? 60 : 48} />
        <div className="min-w-0 flex-1">
          <H
            className={`font-serif font-bold leading-[1.15] tracking-[-0.01em] text-ink ${
              headingLevel === "h1" ? "text-[28px] lg:text-[34px]" : "text-[21px]"
            }`}
          >
            {c.name}
          </H>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <PartyChips parties={c.parties} size="md" />
            {c.incumbent && <IncumbentTag />}
            {c.currentRole && (
              <span className="font-sans text-[12.5px] text-ink-60">{c.currentRole}</span>
            )}
          </div>
          {c.ballotNote && (
            <p className="mt-1 font-sans text-[12px] text-ink-45">{c.ballotNote}</p>
          )}
        </div>
      </div>

      <p className="mt-4 font-serif text-[16px] leading-[1.55] text-ink-80">
        <CitedText c={c.summary} race={race} />
      </p>
      {depthNote && (
        <p className="mt-2 font-sans text-[11.5px] italic text-ink-45">{depthNote}</p>
      )}

      {(c.keyVotes?.length ?? 0) > 0 && (
        <Block title="Key votes in Congress (2025–26)">
          <KeyVoteList candidate={c} />
        </Block>
      )}

      {(c.stateVotes?.length ?? 0) > 0 && (
        <Block title="Contested floor votes in Albany (2026 session)">
          <StateVoteList candidate={c} />
          <p className="mt-1.5 font-sans text-[11.5px] text-ink-45">
            Roll calls where at least five members voted on the losing side, read from the
            legislature&rsquo;s official records.
          </p>
        </Block>
      )}

      {c.record.length > 0 && (
        <Block title="On the record — official actions">
          <ul className="flex flex-col gap-2">
            {c.record.map((r, i) => (
              <li key={i} className="flex gap-2.5 font-sans text-[13px] leading-[1.5] text-ink-80">
                <span className="mt-[3px] w-[52px] flex-none rounded-[3px] border border-chip-border px-1 text-center text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-60">
                  {r.kind}
                </span>
                <span className="min-w-0">
                  {r.date && <span className="text-ink-45">{r.date} · </span>}
                  <CitedText c={r} race={race} />
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {c.positions.length > 0 && (
        <Block title="Positions on the issues">
          <ul className="flex flex-col gap-3">
            {c.positions.map((p) => (
              <li key={p.issue} className="font-sans text-[13px] leading-[1.5] text-ink-80">
                <div className="flex flex-wrap items-center gap-2">
                  <StanceChip stance={p.stance} />
                  <span className="font-semibold text-ink">{ISSUES[p.issue]}</span>
                  {p.basis === "votes" && (
                    <span className="rounded-sm border border-card-strong px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.08em] text-ink-60">
                      From recorded votes
                    </span>
                  )}
                </div>
                <p className="mt-1">
                  {p.summary}
                  <Cites ids={p.sources} race={race} />
                </p>
                {p.quote && (
                  <blockquote className="mt-1 font-serif text-[14px] italic leading-[1.5] text-ink-60">
                    “{p.quote}”
                  </blockquote>
                )}
                {p.stated && (
                  <div className="mt-2 border-l-2 border-card-strong pl-3">
                    <p className="text-[12.5px] text-ink-60">
                      <span className="font-semibold text-ink-80">What they say: </span>
                      {p.stated.stance !== p.stance && (
                        <span className="font-semibold text-ink">
                          (their stated position — {STANCE_WORD[p.stated.stance]} — differs from their votes) {" "}
                        </span>
                      )}
                      {p.stated.summary}
                      <Cites ids={p.stated.sources} race={race} />
                    </p>
                    {p.stated.quote && (
                      <blockquote className="mt-1 font-serif text-[13px] italic leading-[1.5] text-ink-60">
                        “{p.stated.quote}”
                      </blockquote>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {c.priorities.length > 0 && (
        <Block title="In their words — priorities">
          <ul className="flex flex-col gap-2">
            {c.priorities.map((p, i) => (
              <li key={i} className="border-l-2 border-card-strong pl-3 font-sans text-[13.5px] leading-[1.55] text-ink-80">
                <CitedText c={p} race={race} />
              </li>
            ))}
          </ul>
        </Block>
      )}

      {c.background.length > 0 && (
        <Block title="Background">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 font-sans text-[13px] leading-[1.5] text-ink-80 marker:text-ink-35">
            {c.background.map((b, i) => (
              <li key={i}>
                <CitedText c={b} race={race} />
              </li>
            ))}
          </ul>
        </Block>
      )}

      {c.finance && (
        <Block title="Campaign money">
          <FinanceLine candidate={c} />
        </Block>
      )}

      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-hairline-soft pt-3 font-sans text-[12.5px]">
        {c.website && (
          <a href={c.website} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink-80 underline decoration-hairline hover:decoration-ink">
            Campaign website ↗
          </a>
        )}
        {showProfileLink && (
          <Link href={`/guide/race/${race.id}/${c.id}`} className="font-semibold text-ink-80 underline decoration-hairline hover:decoration-ink">
            Shareable profile page
          </Link>
        )}
      </div>
    </article>
  );
}
