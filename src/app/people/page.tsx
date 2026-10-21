import type { Metadata } from "next";
import Link from "@/components/Link";
import { PersonCard } from "@/components/PersonCard";
import { stateName } from "@/lib/usStates";
import { PEOPLE_LEVELS, PEOPLE_PAGE_SIZE, peopleStates, searchPeople, type PeopleFilters, type PeopleLevel } from "@/server/people";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const KINDS = [
  ["office", "In office now"],
  ["ballot", "On the 2026 ballot"],
  ["both", "Both"],
] as const;
const field = "mt-1.5 min-h-11 w-full border border-chip-border bg-paper-raised px-3 text-sm text-ink outline-offset-4 focus:outline-accent";

function parse(params: Record<string, string | string[] | undefined>) {
  const text = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const state = text("state").toUpperCase();
  const kind = KINDS.find(([v]) => v === text("kind"))?.[0];
  const level = PEOPLE_LEVELS.find(([v]) => v === text("level"))?.[0] as PeopleLevel | undefined;
  const filters: PeopleFilters = {
    q: text("q").trim().slice(0, 100),
    state: peopleStates().includes(state) ? state : undefined,
    kind,
    level,
    page: Math.floor(Number(text("page"))) || 1,
  };
  return filters;
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const filtered = Object.keys(await searchParams).length > 0;
  return {
    title: "People — every official and 2026 candidate · The Full Record",
    description: "A directory of current members of Congress, state legislators and NYC Council members, and the candidates on the Nov 3, 2026 ballot we know of, each with a sourced profile.",
    alternates: { canonical: "/people" },
    ...(filtered && { robots: { index: false, follow: true } }),
  };
}

export default async function PeoplePage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parse(await searchParams);
  const { items, total, page, pages } = searchPeople(filters);
  const active = Boolean(filters.q || filters.state || filters.kind || filters.level);
  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const k of ["q", "state", "kind", "level"] as const) if (filters[k]) qs.set(k, filters[k]!);
    if (p > 1) qs.set("page", String(p));
    return `/people${qs.size ? `?${qs}` : ""}`;
  };
  const from = (page - 1) * PEOPLE_PAGE_SIZE + 1;
  const pager = (
    <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-4 font-sans text-sm">
      {page > 1 ? <Link href={href(page - 1)} className="inline-flex min-h-11 items-center font-semibold text-accent-deep underline">‹ Previous</Link> : <span />}
      <span className="text-ink-60">Page {page} of {pages.toLocaleString("en-US")}</span>
      {page < pages ? <Link href={href(page + 1)} className="inline-flex min-h-11 items-center font-semibold text-accent-deep underline">Next ›</Link> : <span />}
    </nav>
  );

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 sm:px-6 lg:px-10">
      <section className="border-b border-card py-9 sm:py-12">
        <p className="text-[11px] font-bold tracking-[0.16em] text-accent-deep">PEOPLE</p>
        <h1 className="mt-4 max-w-2xl font-serif text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">Everyone in office, and everyone running</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-80">
          Every current member of Congress, state legislator and NYC Council member in our data, and every candidate we know of for the Nov 3, 2026 election. Each has one page at a stable address. Names are listed alphabetically; no one is ranked or scored.
        </p>
      </section>

      <form action="/people" method="get" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end">
        <label className="text-xs font-semibold text-ink-60 sm:col-span-2 lg:col-span-1">
          Name
          <input type="search" name="q" defaultValue={filters.q} placeholder="e.g. Ocasio-Cortez" maxLength={100} className={field} />
        </label>
        <label className="text-xs font-semibold text-ink-60">
          State
          <select name="state" defaultValue={filters.state ?? ""} className={field}>
            <option value="">All states</option>
            {peopleStates().map((st) => <option key={st} value={st}>{stateName(st)}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-60">
          Status
          <select name="kind" defaultValue={filters.kind ?? ""} className={field}>
            <option value="">Anyone</option>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-60">
          Office level
          <select name="level" defaultValue={filters.level ?? ""} className={field}>
            <option value="">All levels</option>
            {PEOPLE_LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-4">
          <button type="submit" className="min-h-11 cursor-pointer bg-ink px-5 font-sans text-sm font-semibold text-paper">Search</button>
          {active && <Link href="/people" className="inline-flex min-h-11 items-center text-xs text-accent-deep underline">Reset</Link>}
        </div>
      </form>

      <p aria-live="polite" className="mt-6 font-sans text-sm text-ink-60">
        {total === 0 ? "No one matches those filters." : `Showing ${from.toLocaleString("en-US")}–${(from + items.length - 1).toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`}
      </p>
      {items.length > 0 && (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => <li key={p.slug}><PersonCard person={p} /></li>)}
        </ul>
      )}
      {pages > 1 && pager}
    </main>
  );
}
