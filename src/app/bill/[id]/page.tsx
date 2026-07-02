import { notFound } from "next/navigation";
import { AiMarker } from "@/components/AiMarker";
import { AppHeader } from "@/components/AppHeader";
import { HowYourRepsVoted } from "@/components/HowYourRepsVoted";
import { RollCallCard } from "@/components/RollCallCard";
import { SourceLink } from "@/components/SourceLink";
import { StatusStepper } from "@/components/StatusStepper";
import { getDataSource } from "@/server/datasource";
import type { Official, VoteChoice } from "@/server/types";

export const metadata = { title: "Bill detail — The Full Record" };

export default async function BillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ds = getDataSource();
  const bill = await ds.getBill(id);
  if (!bill) notFound();

  // Your reps who vote on this bill, with their recorded vote from the roll call
  const votingOfficials = (
    await Promise.all(bill.votingOfficialIds.map((oid) => ds.getOfficial(oid)))
  ).filter((o): o is Official => o !== null);
  const repVotes = votingOfficials.map((o) => {
    const lastName = o.name.split(" ")[1] ?? o.name;
    const member = bill.rollCall.members.find((m) => m.name.includes(lastName));
    return { officialId: o.id, vote: (member?.vote ?? "absent") as VoteChoice };
  });

  const whatWhoCard = (
    <section className="rounded-lg border border-card bg-paper-raised p-4 shadow-card">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h2 className="font-sans text-[11px] font-bold tracking-[0.06em] text-ink-45">
            WHAT IT DOES
          </h2>
          <p className="mt-1.5 font-sans text-[13.5px] leading-[1.55] text-ink-80 text-pretty">
            {bill.whatItDoes}
          </p>
        </div>
        <div>
          <h2 className="font-sans text-[11px] font-bold tracking-[0.06em] text-ink-45">
            WHO IT AFFECTS
          </h2>
          <p className="mt-1.5 font-sans text-[13.5px] leading-[1.55] text-ink-80 text-pretty">
            {bill.whoItAffects}
          </p>
        </div>
      </div>
      <AiMarker
        billTextUrl={bill.sources[0]?.url ?? "#"}
        subjectType="bill"
        subjectId={bill.id}
      />
    </section>
  );

  const sourcesLine = (
    <p className="font-sans text-xs text-ink-60">
      Sources:{" "}
      {bill.sources.map((s, i) => (
        <span key={s.label}>
          {i > 0 && <span className="text-[#c9c0ac]"> · </span>}
          <SourceLink href={s.url} className="text-xs">
            {s.label}
          </SourceLink>
        </span>
      ))}
    </p>
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 pb-12">
      <AppHeader backHref="/representatives" backLabel="Back" />

      <div className="px-[26px] pt-6 lg:px-10">
        <div className="font-sans text-[11px] font-bold tracking-[0.06em] text-ink-45">
          {bill.number} · {bill.chamber} · {bill.session}
        </div>
        <h1 className="mt-1 font-serif text-[26px] font-bold leading-[1.2] tracking-[-0.01em] text-ink text-pretty lg:text-[32px]">
          {bill.title}
        </h1>
        <p className="mt-1.5 font-sans text-[13px] text-ink-60">{bill.sponsorLine}</p>
      </div>

      <div className="mt-6 px-[26px] lg:grid lg:grid-cols-[1fr_330px] lg:gap-10 lg:px-10">
        {/* Main column */}
        <div className="flex flex-col gap-5">
          {/* Status stepper — horizontal on mobile only */}
          <div className="lg:hidden">
            <StatusStepper steps={bill.statusSteps} />
          </div>

          {whatWhoCard}

          {/* Mobile: callout sits between summary and roll call */}
          <div className="lg:hidden">
            <HowYourRepsVoted
              bill={bill}
              officials={votingOfficials}
              votes={repVotes}
            />
          </div>

          <RollCallCard rollCall={bill.rollCall} desktop />

          <div className="lg:hidden">{sourcesLine}</div>
        </div>

        {/* Desktop right rail */}
        <aside className="hidden flex-col gap-5 lg:flex">
          <HowYourRepsVoted
            bill={bill}
            officials={votingOfficials}
            votes={repVotes}
          />
          <section className="rounded-lg border border-card bg-paper-raised p-4 shadow-card">
            <h2 className="mb-3 font-sans text-[11px] font-bold tracking-[0.06em] text-ink-45">
              STATUS
            </h2>
            <StatusStepper steps={bill.statusSteps} vertical />
          </section>
          {sourcesLine}
        </aside>
      </div>
    </main>
  );
}
