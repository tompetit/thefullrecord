import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { CandidateBand, CandidateProfile } from "@/components/guide/CandidateProfile";
import { CandidateStand, StandLink } from "@/components/guide/StandClient";
import { alignmentRace } from "@/lib/alignment";
import { SectionLabel, SourceList } from "@/components/guide/ui";
import { StandoutSection } from "@/components/StandoutSection";
import { ContestedVotesSection } from "@/components/ContestedVotesSection";
import { contestedForBioguide, contestedForDistrict, standoutForBioguide, standoutForDistrict } from "@/server/standout";
import { getAllRaces, getCandidate } from "@/server/guide/load";
import { personForCandidate, personHrefForOfficial } from "@/server/people";

export function generateStaticParams() {
  return getAllRaces().flatMap((r) =>
    r.candidates.map((c) => ({ id: r.id, candidate: c.id }))
  );
}

type Params = Promise<{ id: string; candidate: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id, candidate } = await params;
  const found = getCandidate(id, candidate);
  if (!found) return { title: "Candidate not found — The Full Record" };
  return {
    title: `${found.candidate.name} · ${found.race.title} — The Full Record`,
    description: found.candidate.summary.text,
    alternates: { canonical: `/guide/race/${id}/${candidate}` },
  };
}

export default async function CandidatePage({ params }: { params: Params }) {
  const { id, candidate } = await params;
  const found = getCandidate(id, candidate);
  if (!found) notFound();
  const { race, candidate: c } = found;

  // Number citations 1..n in the order they appear on this page (matches CandidateProfile's layout).
  const order = [
    ...c.summary.sources,
    ...c.positions.flatMap((x) => [...(x.basis === "votes" ? x.stated?.sources ?? [] : x.sources), ...(x.votes ?? []).flatMap((v) => v.sources)]),
    ...c.paragraphs.flat().flatMap((x) => x.sources),
    ...c.record.flatMap((x) => x.sources),
    ...c.priorities.flatMap((x) => x.sources),
    ...(c.statements ?? []).flatMap((x) => x.sources),
  ];
  const sources = [...new Set(order)].flatMap((id) => race.sources.find((s) => s.id === id) ?? []);
  const pageRace = { ...race, sources };
  const person = personForCandidate(race.id, c.id);
  const opponents = race.candidates.filter((o) => o.id !== c.id);
  const slim = alignmentRace(race);
  // Incumbents only: Congress by bioguide id, Albany by the race's district when the votes were matched.
  const standout = c.bioguideId
    ? standoutForBioguide(c.bioguideId)
    : c.incumbent && c.stateVotes?.length && /^ny-(ad|sd)-\d+$/.test(race.id)
      ? standoutForDistrict(race.id)
      : null;
  const contested = c.bioguideId ? contestedForBioguide(c.bioguideId, 5) : standout ? contestedForDistrict(race.id, 5) : [];

  return (
    <main className="flex-1 pb-4">
      <CandidateBand
        race={pageRace}
        candidate={c}
        breadcrumb={
          <nav aria-label="Breadcrumb">
            <Link href="/guide">Guide</Link> ›{" "}
            <StandLink href={`/guide/race/${race.id}`}>{race.title}</StandLink>
          </nav>
        }
      />
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10">
        <CandidateProfile race={pageRace} candidate={c} />
        {person && (
          <p className="mt-3 font-sans text-[13px] text-ink-60">
            Profile:{" "}
            <Link href={`/people/${person.slug}`} className="inline-flex min-h-11 items-center font-semibold text-accent underline">/people/{person.slug}</Link>
          </p>
        )}
        {standout && (
          <div className="mt-4">
            <StandoutSection standout={standout} max={3} fullRecordHref={personHrefForOfficial(race.id)} />
          </div>
        )}
        {contested.length > 0 && <div className="mt-4"><ContestedVotesSection votes={contested} max={5} allHref={personHrefForOfficial(race.id)} /></div>}
        <CandidateStand race={{ ...slim, candidates: slim.candidates.filter((x) => x.id === c.id) }} candidateId={c.id} />
        {opponents.length > 0 && (
          <p className="mt-4 font-sans text-[13px] text-ink-60">
            <StandLink href={`/guide/race/${race.id}`} className="font-semibold text-accent underline">
              Compare all {race.candidates.length} candidates side by side ›
            </StandLink>
          </p>
        )}
        <section id="sources" className="mt-8 scroll-mt-4">
          <SectionLabel>Sources cited in this profile</SectionLabel>
          <div className="mt-3 border border-card bg-paper-raised px-4 py-3">
            <SourceList race={pageRace} />
          </div>
        </section>
      </div>
    </main>
  );
}
