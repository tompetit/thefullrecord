import { AppHeader } from "@/components/AppHeader";
import { OfficialCard } from "@/components/OfficialCard";
import { SourceLink } from "@/components/SourceLink";
import { getDataSource } from "@/server/datasource";

export const metadata = { title: "Your representatives — The Full Record" };

export default async function RepresentativesPage() {
  const ds = getDataSource();
  const [groups, stats] = await Promise.all([
    // A real data source resolves this from the saved address; the
    // placeholder returns the same officials for any address.
    ds.getOfficialsByAddress(""),
    ds.getSiteStats(),
  ]);
  const count = groups.reduce((n, g) => n + g.officials.length, 0);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 pb-12">
      <AppHeader />

      <div className="px-[26px] pt-7 lg:px-10">
        <h1 className="font-serif text-[26px] font-semibold tracking-[-0.01em] text-ink lg:text-[32px]">
          Your representatives
        </h1>
        <p className="mt-1 font-sans text-[13.5px] text-ink-60">
          {count} officials represent this address, city to federal.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-7 px-[26px] lg:px-10">
        {groups.map((group) => (
          <section
            key={group.level}
            className="border-t border-hairline-soft pt-5 lg:grid lg:grid-cols-[180px_1fr] lg:gap-6"
          >
            <h2 className="mb-3 font-sans text-[11px] font-bold tracking-[0.08em] text-ink-45 lg:sticky lg:top-4 lg:mb-0 lg:self-start">
              {group.label}
            </h2>
            <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2">
              {group.officials.map((official) => (
                <OfficialCard key={official.id} official={official} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-8 px-[26px] font-sans text-xs leading-normal text-ink-45 lg:px-10">
        {stats.provenanceLine}.{" "}
        <SourceLink href="#" className="text-xs">
          How lookup works
        </SourceLink>
      </p>
    </main>
  );
}
