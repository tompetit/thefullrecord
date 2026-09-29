import Link from "next/link";
import { BallotAddressForm } from "@/components/guide/BallotAddressForm";
import { GuideSearch } from "@/components/guide/GuideSearch";
import { ALL_STATES, stateName } from "@/components/guide/RaceView";
import { GuideFooter, GuideNav, SectionLabel } from "@/components/guide/ui";
import { getAllRaces, getGuideStats } from "@/server/guide/load";
import { toSearchRaces } from "@/server/guide/search";

export const metadata = {
  title: "2026 Voter Guide — The Full Record",
  description:
    "Explore researched candidate profiles, recorded votes, and documented positions for the 2026 elections, with sources and coverage notes.",
};

export const revalidate = 3600;

const DAYS_UNTIL = (() => {
  const ms = Date.UTC(2026, 10, 3) - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
})();

export default function GuidePage() {
  const races = getAllRaces();
  const stats = getGuideStats();
  const nyc = races.filter((r) => r.inNYC);
  const nycGroups: Array<[string, typeof races]> = [
    ["Statewide & ballot measures", nyc.filter((r) => ["governor", "attorney-general", "comptroller", "ballot-measure"].includes(r.officeType))],
    ["U.S. House", nyc.filter((r) => r.officeType === "us-house")],
    ["NY State Senate", nyc.filter((r) => r.officeType === "state-senate")],
    ["NY State Assembly", nyc.filter((r) => r.officeType === "state-assembly")],
  ];
  const byState = new Map<string, number>();
  for (const r of races) byState.set(r.state, (byState.get(r.state) ?? 0) + 1);

  return (
    <main className="flex-1">
      <GuideNav active="guide" />

      <section className="mx-auto grid w-full max-w-6xl gap-10 px-[20px] pt-10 lg:grid-cols-[1.2fr_1fr] lg:px-10 lg:pt-14">
        <div>
          <p className="font-sans text-[11px] font-bold tracking-[0.1em] text-accent">
            GENERAL ELECTION · TUESDAY, NOVEMBER 3, 2026 · {DAYS_UNTIL} DAYS AWAY
          </p>
          <h1 className="mt-3 font-serif text-[36px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink text-pretty lg:text-[54px]">
            Know who&rsquo;s on your ballot — by what they&rsquo;ve actually done.
          </h1>
          <p className="mt-4 max-w-xl font-sans text-[15px] leading-[1.6] text-ink-60">
            Explore researched candidates in New York City, New Jersey, and
            U.S. House and Senate races across the country. Follow sources for
            their votes and documented positions. Research depth varies; this
            is not an official or complete ballot. No endorsements, no scores.
          </p>
          <BallotAddressForm />
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/guide/match"
              className="rounded-[10px] border-[1.5px] border-ink px-4 py-2.5 font-sans text-[14px] font-bold text-ink hover:bg-ink hover:text-paper"
            >
              Compare candidate evidence by issue →
            </Link>
            <Link
              href="/guide/key-votes"
              className="rounded-[10px] border border-chip-border px-4 py-2.5 font-sans text-[14px] font-semibold text-ink-80 hover:border-card-strong"
            >
              Key votes in Congress
            </Link>
          </div>
        </div>
        <aside className="grid grid-cols-2 content-start gap-3 self-start">
          {[
            [stats.races.toLocaleString(), "races researched"],
            [stats.candidates.toLocaleString(), "candidates profiled"],
            [stats.sources.toLocaleString(), "sources cited"],
            [stats.officialSources.toLocaleString(), "official records cited"],
          ].map(([n, l]) => (
            <div key={l} className="rounded-lg border border-card bg-paper-raised p-4">
              <div className="font-serif text-[30px] font-bold leading-none text-ink">{n}</div>
              <div className="mt-1.5 font-sans text-[12px] text-ink-60">{l}</div>
            </div>
          ))}
          <p className="col-span-2 font-sans text-[12px] leading-normal text-ink-45">
            Researched from roll calls, bill records, FEC filings, candidate
            statements, and reporting. See{" "}
            <Link href="/guide/methodology" className="underline">how we research</Link>.
          </p>
        </aside>
      </section>

      <section className="mx-auto mt-14 w-full max-w-6xl px-[20px] lg:px-10">
        <SectionLabel>Search researched races</SectionLabel>
        <div className="mt-3">
          <GuideSearch races={toSearchRaces(races)} />
        </div>
      </section>

      {nyc.length > 0 && (
        <section className="mx-auto mt-14 w-full max-w-6xl px-[20px] lg:px-10">
          <SectionLabel>New York City ballot</SectionLabel>
          <div className="mt-4 grid gap-8 lg:grid-cols-2">
            {nycGroups.filter(([, list]) => list.length).map(([label, list]) => (
              <div key={label}>
                <h3 className="font-serif text-[20px] font-bold text-ink">{label}</h3>
                <ul className="mt-2 flex flex-col divide-y divide-hairline-soft border-y border-hairline-soft">
                  {list.map((r) => (
                    <li key={r.id}>
                      <Link href={`/guide/race/${r.id}`} className="flex items-baseline justify-between gap-3 py-2 hover:bg-paper-raised">
                        <span className="font-sans text-[13.5px] font-semibold text-ink-80">
                          {r.title.replace(/^.*?·\s*/, "")}
                        </span>
                        <span className="truncate text-right font-sans text-[12px] text-ink-45">
                          {r.candidates.map((c) => c.name.split(" ").slice(-1)[0]).join(" · ")}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto mt-14 w-full max-w-6xl px-[20px] lg:px-10">
        <SectionLabel>Congress, state by state</SectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-5">
          {ALL_STATES.map((st) => (
            <Link
              key={st}
              href={`/guide/state/${st.toLowerCase()}`}
              className="flex items-baseline justify-between rounded-md border border-hairline-soft bg-paper-raised px-3 py-2 font-sans text-[13px] text-ink-80 hover:border-card-strong"
            >
              <span className="font-semibold">{stateName(st)}</span>
              <span className="text-[11px] text-ink-45">{byState.get(st) ?? 0}</span>
            </Link>
          ))}
        </div>
      </section>
      <GuideFooter />
    </main>
  );
}
