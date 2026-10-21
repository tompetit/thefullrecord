import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { OfficialProfile } from "@/components/OfficialProfile";
import { PartyChip } from "@/components/PartyChip";
import { PersonCard } from "@/components/PersonCard";
import { PersonPhoto } from "@/components/PersonPhoto";
import { CitedText, PartyChips, SourceList } from "@/components/guide/ui";
import { SourceLink } from "@/components/SourceLink";
import { SITE_URL, ballotLabel, partyChipProps, partyOrgName } from "@/lib/people";
import { getDataSource } from "@/server/datasource";
import { getCandidate, getRace } from "@/server/guide/load";
import { electionForSeat } from "@/server/live/elections";
import { getBio } from "@/server/bios";
import { getPerson, peopleInRace, peopleInSeat, type Candidacy, type Person } from "@/server/people";

type Params = Promise<{ slug: string }>;

const raceLabel = (c: Candidacy, p: Person) => (c.raceId && getRace(c.raceId)?.title) || ballotLabel(c, p.state);

function describe(p: Person) {
  const role = p.offices?.[0]?.role;
  const run = p.candidacies?.[0];
  const ballot = run ? `On the Nov 3, 2026 ballot for ${raceLabel(run, p)}. ` : "";
  return {
    title: `${p.name} — ${role ?? (run ? `candidate for ${raceLabel(run, p)}` : "profile")} · The Full Record`,
    description: `${p.name}${role ? `, ${role}` : ""}. ${ballot}Sourced profile on The Full Record.`,
  };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = getPerson((await params).slug);
  if (!p) return { title: "Person not found · The Full Record" };
  const { title, description } = describe(p);
  const url = `/people/${p.slug}`;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, type: "profile", siteName: "The Full Record" } };
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-8">
    <h2 className="font-sans text-[22px] font-bold leading-tight tracking-[-0.01em] text-ink">{title}</h2>
    <div className="mt-3">{children}</div>
  </section>
);

export default async function PersonPage({ params, searchParams }: { params: Params; searchParams: Promise<{ address?: string }> }) {
  const person = getPerson((await params).slug);
  if (!person) notFound();
  const query = await searchParams;
  const address = typeof query.address === "string" ? query.address.trim().slice(0, 250) : "";
  const office = person.offices?.[0];
  const official = office ? await getDataSource().getOfficial(office.officialId) : null;
  const candidacies = person.candidacies ?? [];
  const bio = getBio(person.slug);
  const partyCode = official ? person.party : undefined;
  const ballotParties = candidacies[0]?.parties ?? [];
  const jsonLdParty = partyCode ?? ballotParties[0];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: person.name,
    url: `${SITE_URL}/people/${person.slug}`,
    ...(office && { jobTitle: office.role }),
    ...(jsonLdParty && { affiliation: { "@type": "Organization", name: partyOrgName(jsonLdParty) } }),
    ...(person.photo && { image: person.photo.url }),
  };

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 pb-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <header className="bg-band text-band-ink">
        <div className="flex items-start gap-4 px-4 pb-6 pt-6 sm:px-6 lg:px-10">
          <div className="flex flex-col items-center gap-1">
            <PersonPhoto name={person.name} url={person.photo?.url} size={88} />
            {person.photo && <span className="max-w-[110px] break-words text-center font-sans text-[10.5px] text-band-muted">Photo: {person.photo.source}</span>}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="font-mono text-[12px] tracking-[0.02em] text-band-muted">{person.state} · {office ? "Officeholder" : "Candidate"}</p>
            <h1 className="text-balance font-sans text-[30px] font-extrabold leading-none tracking-[-0.025em] sm:text-[40px]">{person.name}</h1>
            <p className="flex flex-wrap items-center gap-1.5 font-serif text-[16px] text-band-muted [&_span[title]]:border-band-muted [&_span[title]]:text-band-ink">
              {partyCode && <PartyChip {...partyChipProps(partyCode)} />}
              {!partyCode && ballotParties.length > 0 && <PartyChips parties={ballotParties} />}
              {office ? <b className="font-medium text-band-ink">{office.role}</b> : <span>Candidate</span>}
            </p>
            {candidacies.map((c) => {
              const href = c.raceId ? `/guide/race/${c.raceId}` : person.state !== "NY" && c.seatKey ? `/guide/state/${person.state.toLowerCase()}` : null;
              return (
                <p key={c.raceId ?? c.seatKey} className="font-sans text-[13px] text-band-muted">
                  On the ballot Nov 3, 2026:{" "}
                  {href ? <Link href={href} className="font-semibold text-band-ink underline decoration-band-muted underline-offset-4 hover:decoration-band-ink">{raceLabel(c, person)}</Link> : <span className="font-semibold text-band-ink">{raceLabel(c, person)}</span>}
                </p>
              );
            })}
          </div>
        </div>
      </header>

      <div className="px-4 sm:px-6 lg:px-10 [&>*]:max-w-4xl">
        {bio && (
          <Section title="Biography">
            <div className="border border-card bg-paper-raised px-5 py-4">
            <p className="font-serif text-[17.5px] leading-[1.55] text-ink">
              {bio.summary.map((c, i) => (
                <span key={i}>
                  <CitedText c={c} race={bio} />{" "}
                </span>
              ))}
            </p>
            {bio.paragraphs.map((para, i) => (
              <p key={i} className="mt-3 font-sans text-[14px] leading-[1.6] text-ink-80">
                {para.map((c, j) => (
                  <span key={j}>
                    <CitedText c={c} race={bio} />{" "}
                  </span>
                ))}
              </p>
            ))}
            <div className="mt-3">
              <SourceList race={bio} />
            </div>
            <p className="mt-1 font-sans text-[11.5px] text-ink-45">Researched from the cited sources on {bio.researchedAt}.{bio.factChecked === false && " Not yet independently fact-checked."}</p>
            </div>
          </Section>
        )}
        {candidacies.map((c) => {
          const found = c.raceId && c.candidateId ? getCandidate(c.raceId, c.candidateId) : null;
          if (found) {
            const others = found.race.candidates.filter((o) => o.id !== found.candidate.id);
            return (
              <Section key={c.raceId} title="On the ballot">
                <p className="flex flex-wrap gap-x-4 font-sans text-[13px]">
                  <Link href={`/guide/race/${c.raceId}/${c.candidateId}`} className="inline-flex min-h-11 items-center font-semibold text-accent underline">Full candidate research ›</Link>
                  <Link href={`/guide/race/${c.raceId}`} className="inline-flex min-h-11 items-center font-semibold text-accent underline">{found.race.title} ›</Link>
                </p>
                {others.length > 0 && (
                  <>
                    <h3 className="mt-3 font-sans text-[12px] font-bold text-ink-60">Also on the ballot for this seat</h3>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {peopleInRace(c.raceId!).filter((o) => o.slug !== person.slug).map((o) => <PersonCard key={o.slug} person={o} />)}
                    </div>
                  </>
                )}
              </Section>
            );
          }
          return null;
        })}
        {await Promise.all(
          candidacies.filter((c) => c.seatKey && !c.raceId).map(async (c) => {
            const election = await electionForSeat(c.seatKey!);
            const others = peopleInSeat(c.seatKey!).filter((o) => o.slug !== person.slug);
            return (
              <Section key={c.seatKey} title={raceLabel(c, person)}>
                <p className="font-sans text-[13.5px] leading-normal text-ink-80">
                  {person.name} is on the Nov 3, 2026 ballot for {raceLabel(c, person)}
                  {c.parties.length > 0 && <> as <PartyChips parties={c.parties} /></>}. Not researched in depth — candidate list only.
                </p>
                {election && "sourceUrl" in election && (
                  <p className="mt-1 inline-flex min-h-11 items-center font-sans text-[13px]">
                    <SourceLink href={election.sourceUrl}>{election.sourceLabel}</SourceLink>
                  </p>
                )}
                {others.length > 0 && (
                  <>
                    <h3 className="mt-2 font-sans text-[12px] font-bold text-ink-60">Other candidates for this seat</h3>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">{others.map((o) => <PersonCard key={o.slug} person={o} />)}</div>
                  </>
                )}
              </Section>
            );
          })
        )}
      </div>

      {official && (
        <div className="mt-6">
          <OfficialProfile official={official} address={address} compact />
        </div>
      )}
    </main>
  );
}
