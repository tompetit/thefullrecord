import Link from "next/link";
import {
  compareCandidate,
  countsSentence,
  TOPIC_LABELS,
  type AlignmentRace,
  type Outcome,
  type StandEntry,
} from "@/lib/alignment";
import { ISSUES } from "@/server/guide/types";
import { Cites, PartyChips } from "./ui";

/**
 * Presentational only (no hooks), so both the client matcher and the
 * search-param wrappers on race/candidate pages can render it.
 * Outcomes are glyph + word + border — identical colour for every outcome.
 */
const OUTCOME: Record<Outcome, { mark: string; word: string; cls: string }> = {
  same: { mark: "=", word: "Same as you", cls: "border-ink-80 border-solid text-ink" },
  different: { mark: "≠", word: "Different from you", cls: "border-ink-80 border-solid text-ink" },
  mixed: { mark: "~", word: "Mixed record", cls: "border-ink-45 border-solid text-ink-80" },
  not_inferred: { mark: "○", word: "Votes shown — not compared", cls: "border-dash-border border-dashed text-ink-80" },
  none: { mark: "–", word: "No documented position", cls: "border-dash-border border-dashed text-ink-60" },
};

const STANCE_WORD = { supports: "Supports", opposes: "Opposes", mixed: "Mixed on" } as const;

export const DISCLAIMER =
  "This compares your answers with documented positions. It is not a recommendation and doesn't rank candidates.";

export function AlignmentDisclaimer({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <p className="border-l-4 border-ink bg-paper-raised px-4 py-3 font-sans text-[14px] font-semibold leading-snug text-ink">
        {DISCLAIMER}{" "}
        <Link href="/guide/methodology#where-i-stand" className="font-normal text-ink-60 underline hover:text-ink">
          How this works
        </Link>
      </p>
      <p className="mt-2 font-sans text-[12px] leading-snug text-ink-60">
        &ldquo;No documented position&rdquo; means our research found nothing on that topic for this candidate. Missing evidence is not a position.
      </p>
    </div>
  );
}

function OutcomeTag({ outcome }: { outcome: Outcome }) {
  const o = OUTCOME[outcome];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border-[1.5px] bg-paper px-2 py-0.5 font-sans text-[12px] font-bold ${o.cls}`}>
      <span aria-hidden className="font-mono text-[13px] leading-none">{o.mark}</span>
      {o.word}
    </span>
  );
}

function BasisTag({ basis }: { basis: "votes" | "statements" }) {
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        basis === "votes" ? "border-accent-tint-border bg-accent-tint text-accent-deep" : "border-chip-border bg-canvas text-ink-60"
      }`}
    >
      {basis === "votes" ? "Based on recorded votes" : "Based on statements"}
    </span>
  );
}

export function AlignmentBreakdown({
  race,
  candidate,
  stand,
  nameHref,
  headingLevel = "h3",
}: {
  race: Pick<AlignmentRace, "sources">;
  candidate: AlignmentRace["candidates"][number];
  stand: StandEntry[];
  /** When set, the candidate name is shown as a link (matcher / race page). */
  nameHref?: string;
  headingLevel?: "h2" | "h3";
}) {
  const { items, counts } = compareCandidate(candidate.positions, stand);
  const H = headingLevel;
  const Item = headingLevel === "h2" ? "h3" : "h4";
  return (
    <article className="min-w-0 border border-card bg-paper-raised p-4 sm:p-5" aria-label={`${candidate.name}: comparison with your answers`}>
      {nameHref !== undefined && (
        <div className="flex flex-wrap items-center gap-2">
          <H className="font-serif text-xl font-semibold text-ink">
            <Link href={nameHref} className="hover:underline">{candidate.name}</Link>
          </H>
          <PartyChips parties={candidate.parties} />
        </div>
      )}
      <p className="mt-2 font-sans text-[13px] font-semibold text-ink-80">{countsSentence(counts)}</p>
      <ul className="mt-3 divide-y divide-hairline">
        {items.filter((item) => item.outcome !== "none").map((item) => {
          const p = item.position;
          return (
            <li key={item.issue} className="py-4 first:pt-1">
              <Item className="text-sm font-bold text-ink">{TOPIC_LABELS[item.issue]}</Item>
              <p className="mt-0.5 font-sans text-[12px] leading-snug text-ink-60">
                You: <b className="text-ink-80">{item.answer === "agree" ? "Agree" : "Disagree"}</b> — &ldquo;{ISSUES[item.issue]}&rdquo;
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <OutcomeTag outcome={item.outcome} />
                {item.basis && <BasisTag basis={item.basis} />}
              </div>
              {p && item.outcome === "not_inferred" && (
                <>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink-60">
                    We don&rsquo;t infer a direction on this statement from votes, so this topic isn&rsquo;t counted as same or different. The recorded votes:
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-80">
                    {p.summary} <Cites ids={p.sources} race={race} />
                  </p>
                  {p.stated && (
                    <p className="mt-2 border-l-2 border-card-strong pl-3 text-[12.5px] leading-relaxed text-ink-60">
                      <span className="font-semibold text-ink-80">What they say (documented separately): </span>
                      {p.stated.summary} <Cites ids={p.stated.sources} race={race} />
                    </p>
                  )}
                </>
              )}
              {p && item.outcome !== "not_inferred" && (
                <>
                  <p className="mt-2 text-sm leading-relaxed text-ink-80">
                    <span className="font-semibold">
                      {STANCE_WORD[p.stance as keyof typeof STANCE_WORD]} the statement:
                    </span>{" "}
                    {p.summary} <Cites ids={p.sources} race={race} />
                  </p>
                  {p.quote && (
                    <blockquote className="mt-1 font-serif text-[14px] italic leading-[1.5] text-ink-60">&ldquo;{p.quote}&rdquo;</blockquote>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {counts.none > 0 && (
        <p className="mt-3 border-t border-hairline pt-3 font-sans text-[12.5px] leading-snug text-ink-60">
          No documented position on: {items.filter((item) => item.outcome === "none").map((item) => TOPIC_LABELS[item.issue]).join(", ")}
        </p>
      )}
    </article>
  );
}
