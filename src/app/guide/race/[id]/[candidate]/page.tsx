import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CandidateProfile } from "@/components/guide/CandidateProfile";
import { GuideFooter, GuideNav, SectionLabel, SourceList } from "@/components/guide/ui";
import { getAllRaces, getCandidate } from "@/server/guide/load";

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
  };
}

export default async function CandidatePage({ params }: { params: Params }) {
  const { id, candidate } = await params;
  const found = getCandidate(id, candidate);
  if (!found) notFound();
  const { race, candidate: c } = found;

  const used = new Set<string>([
    ...c.summary.sources,
    ...c.background.flatMap((x) => x.sources),
    ...c.priorities.flatMap((x) => x.sources),
    ...c.positions.flatMap((x) => x.sources),
    ...c.record.flatMap((x) => x.sources),
  ]);
  const opponents = race.candidates.filter((o) => o.id !== c.id);

  return (
    <main className="flex-1 pb-4">
      <GuideNav active="guide" />
      <div className="mx-auto w-full max-w-4xl px-[20px] pt-6 lg:px-10">
        <nav className="font-sans text-[12.5px] text-ink-60">
          <Link href="/guide" className="hover:text-ink">Guide</Link> ›{" "}
          <Link href={`/guide/race/${race.id}`} className="hover:text-ink">{race.title}</Link>
        </nav>
        <div className="mt-3">
          <CandidateProfile race={race} candidate={c} headingLevel="h1" />
        </div>
        {opponents.length > 0 && (
          <p className="mt-4 font-sans text-[13px] text-ink-60">
            Also on the ballot for this seat:{" "}
            {opponents.map((o, i) => (
              <span key={o.id}>
                {i > 0 && ", "}
                <Link href={`/guide/race/${race.id}/${o.id}`} className="font-semibold text-ink-80 underline decoration-hairline hover:decoration-ink">
                  {o.name}
                </Link>
              </span>
            ))}{" "}
            ·{" "}
            <Link href={`/guide/race/${race.id}`} className="underline hover:text-ink">
              Compare side by side
            </Link>
          </p>
        )}
        <section className="mt-8">
          <SectionLabel>Sources cited in this profile</SectionLabel>
          <div className="mt-3">
            <SourceList race={race} ids={used} />
          </div>
        </section>
      </div>
      <GuideFooter />
    </main>
  );
}
