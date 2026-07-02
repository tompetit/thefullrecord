import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { PartyChip } from "@/components/PartyChip";
import { ProfileTabs } from "@/components/ProfileTabs";
import { SourceLink } from "@/components/SourceLink";
import { getDataSource } from "@/server/datasource";

export const metadata = { title: "Official profile — The Full Record" };

/** The core screen: identity + committees + stats + the activity feed. */
export default async function OfficialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ds = getDataSource();
  const official = await ds.getOfficial(id);
  if (!official) notFound();

  const [votes, sponsorships, attendance, saidDidPairs] = await Promise.all([
    ds.getVotes(id),
    ds.getSponsorships(id),
    ds.getAttendance(id),
    ds.getSaidDidPairs(id),
  ]);

  const roleLine = official.locality
    ? `${official.role} · ${official.locality}`
    : official.role;

  const identity = (
    <>
      <div className="flex items-start gap-3.5 lg:flex-col lg:gap-4">
        <Avatar size={64} />
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-[26px] font-bold leading-[1.1] tracking-[-0.01em] text-ink">
            {official.name}
          </h1>
          <p className="font-sans text-[13px] text-ink-80">{roleLine}</p>
          <p className="flex items-center gap-1.5 font-sans text-xs text-ink-60">
            {official.tenure} · <PartyChip party={official.party} />
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5 font-sans text-[11.5px] text-ink-80">
        {official.committees.map((c) => (
          <span key={c} className="rounded-full border border-chip-border px-2.5 py-1">
            {c}
          </span>
        ))}
        <a
          href={official.contactUrl}
          className="rounded-full border border-chip-border px-2.5 py-1 hover:border-card-strong"
        >
          Contact ↗
        </a>
      </div>
    </>
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 pb-12">
      <AppHeader />

      <div className="px-[26px] pt-5 lg:grid lg:grid-cols-[300px_1fr] lg:gap-10 lg:px-10">
        {/* Left rail (desktop) / header stack (mobile) */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Link
            href="/representatives"
            className="flex min-h-11 items-center font-sans text-[12.5px] text-ink-60 hover:text-ink"
          >
            ‹ Your representatives
          </Link>

          {identity}

          {/* Stat strip (mobile) / stat table (desktop) — omit stats the source doesn't provide yet */}
          {(() => {
            const stats: Array<[string, string, string | number]> = [];
            if (official.stats.votesThisSession !== null)
              stats.push([
                "Votes this session",
                "votes this session",
                official.stats.votesThisSession,
              ]);
            if (official.stats.rollCallsAttendedPct !== null)
              stats.push([
                "Roll calls attended",
                "roll calls attended",
                `${official.stats.rollCallsAttendedPct}%`,
              ]);
            if (official.stats.billsSponsored !== null)
              stats.push([
                "Bills sponsored",
                "bills sponsored",
                official.stats.billsSponsored,
              ]);
            if (!stats.length) return null;
            return (
              <>
                <div
                  className="mt-5 grid overflow-hidden rounded-[10px] border border-card bg-paper-raised lg:hidden"
                  style={{
                    gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
                  }}
                >
                  {stats.map(([, label, value], i) => (
                    <div
                      key={label}
                      className={`px-2 py-3 text-center ${i < stats.length - 1 ? "border-r border-hairline-soft" : ""}`}
                    >
                      <div className="font-serif text-[19px] font-bold text-ink">
                        {value}
                      </div>
                      <div className="font-sans text-[10.5px] text-ink-45">
                        {label}
                      </div>
                    </div>
                  ))}
                </div>
                <dl className="mt-5 hidden flex-col divide-y divide-hairline-soft rounded-[10px] border border-card bg-paper-raised lg:flex">
                  {stats.map(([label, , value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between px-4 py-2.5"
                    >
                      <dt className="font-sans text-xs text-ink-60">{label}</dt>
                      <dd className="font-serif text-[17px] font-bold text-ink">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            );
          })()}

          <p className="mt-4 hidden font-sans text-[11.5px] leading-normal text-ink-45 lg:block">
            {official.methodologyNote}{" "}
            <SourceLink href="#" className="text-[11.5px]">
              Methodology
            </SourceLink>
          </p>
        </aside>

        {/* Feed */}
        <div className="mt-6 lg:mt-0">
          <ProfileTabs
            official={official}
            initialVotes={votes}
            sponsorships={sponsorships}
            attendance={attendance}
            saidDidPairs={saidDidPairs}
          />
        </div>
      </div>
    </main>
  );
}
