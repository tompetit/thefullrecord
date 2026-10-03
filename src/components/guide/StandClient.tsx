"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ComponentProps } from "react";
import { parseStand, serializeStand, withStand, type AlignmentRace, type StandEntry } from "@/lib/alignment";
import { ISSUES, type IssueKey } from "@/server/guide/types";
import { AlignmentBreakdown, AlignmentDisclaimer } from "./Alignment";

/*
 * Race and candidate pages are prerendered, so the voter's `stand` answers are
 * read on the client only (inside Suspense, per the useSearchParams docs).
 * Nothing here is stored or sent anywhere.
 */

export const ISSUE_KEYS = Object.keys(ISSUES) as IssueKey[];

function useStand(): { stand: StandEntry[]; param: string } {
  const stand = parseStand(useSearchParams().get("stand"), ISSUE_KEYS);
  return { stand, param: serializeStand(stand) };
}

type LinkProps = ComponentProps<typeof Link> & { href: string };

function StandLinkInner({ href, ...rest }: LinkProps) {
  const { param } = useStand();
  return <Link href={withStand(href, param)} {...rest} />;
}

/** A guide link that carries the voter's `stand` answers along, when present. */
export function StandLink(props: LinkProps) {
  return (
    <Suspense fallback={<Link {...props} />}>
      <StandLinkInner {...props} />
    </Suspense>
  );
}

function Shell({ param, children, title }: { param: string; children: React.ReactNode; title: string }) {
  const pathname = usePathname();
  return (
    <section className="mt-8 border border-card-strong bg-canvas p-4 sm:p-5" aria-labelledby="where-you-stand">
      <h2 id="where-you-stand" className="font-serif text-2xl font-semibold text-ink">{title}</h2>
      <AlignmentDisclaimer className="mt-3" />
      <p className="mt-2 font-sans text-[12.5px] leading-relaxed text-ink-60">
        Your answers come from this page&rsquo;s link and aren&rsquo;t saved. Coverage varies by candidate; missing evidence is not a position.{" "}
        <Link href={withStand("/guide/match", param)} className="underline hover:text-ink">Change your answers</Link>
        {" · "}
        <Link href={pathname} className="underline hover:text-ink">Hide this comparison</Link>
      </p>
      {children}
    </section>
  );
}

function RaceStandInner({ race }: { race: AlignmentRace }) {
  const { stand, param } = useStand();
  if (!stand.length || !race.candidates.length) return null;
  return (
    <Shell param={param} title="Where you stand, compared">
      <p className="mt-3 font-sans text-[12.5px] text-ink-60">Candidates in alphabetical order.</p>
      <div className="mt-3 grid items-start gap-4 lg:grid-cols-2">
        {race.candidates.map((c) => (
          <AlignmentBreakdown
            key={c.id}
            race={race}
            candidate={c}
            stand={stand}
            nameHref={withStand(`/guide/race/${race.id}/${c.id}`, param)}
          />
        ))}
      </div>
    </Shell>
  );
}

/** Every candidate in a race, compared with `?stand=` answers (renders nothing without them). */
export function RaceStand({ race }: { race: AlignmentRace }) {
  return (
    <Suspense fallback={null}>
      <RaceStandInner race={race} />
    </Suspense>
  );
}

function CandidateStandInner({ race, candidateId }: { race: AlignmentRace; candidateId: string }) {
  const { stand, param } = useStand();
  const candidate = race.candidates.find((c) => c.id === candidateId);
  if (!stand.length || !candidate) return null;
  return (
    <Shell param={param} title={`Where you stand, compared with ${candidate.name}`}>
      <div className="mt-3">
        <AlignmentBreakdown race={race} candidate={candidate} stand={stand} />
      </div>
    </Shell>
  );
}

export function CandidateStand({ race, candidateId }: { race: AlignmentRace; candidateId: string }) {
  return (
    <Suspense fallback={null}>
      <CandidateStandInner race={race} candidateId={candidateId} />
    </Suspense>
  );
}
