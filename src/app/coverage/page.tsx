import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { getSnapshots } from "@/server/live/snapshot";
import { REPO_URL } from "@/lib/site";

export const metadata = { title: "Data coverage & limitations — The Full Record", description: "See exactly which roll-call records The Full Record includes, their dates, sources, and the gaps in our coverage." };
const NOTES: Record<string, string> = {
  "U.S. HOUSE": "A bounded set of recorded House votes. Voice votes and unrecorded actions are not included.",
  "U.S. SENATE": "A bounded set of recorded Senate votes, including procedural motions and nominations. Check the motion before interpreting a vote.",
  "NY SENATE": "Selected floor votes discovered through the OpenLegislation ingest. This is not every bill or floor vote in the session.",
  "NY ASSEMBLY": "A sample drawn from passed bills with accessible floor-vote records. Failed bills and other floor actions are underrepresented.",
  "NYC COUNCIL": "Selected legislation with accessible recorded votes. This is not a complete history of Council or committee activity.",
};
function date(value: string) {
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? "Not available" : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
const range = (items: { date: string }[]) => {
  const dates = items.map((r) => r.date).sort();
  return dates.length ? `${date(dates[0])} – ${date(dates.at(-1)!)}` : "no records";
};

export default function CoveragePage() {
  const snapshots = getSnapshots();
  const house = snapshots.find((s) => s.chamber === "U.S. HOUSE");
  const senate = snapshots.find((s) => s.chamber === "U.S. SENATE");
  const stateVotes = snapshots.filter((s) => s.keyBy === "openstates");
  const statesWithVotes = [...new Set(stateVotes.map((s) => s.jurisdiction!.toUpperCase()))].sort();
  const stateVoteCount = stateVotes.reduce((n, s) => n + s.rollCalls.length, 0);
  const places: Array<[string, string, string]> = [
    [
      "U.S. Congress",
      "Everywhere",
      `Roster and recorded roll calls for every member of Congress, including delegates for D.C. and the territories. ${house ? `${Object.keys(house.memberKeys ?? {}).length} House seats and ${house.rollCalls.length} recent House roll calls (${range(house.rollCalls)}). ` : ""}${senate ? `${Object.keys(senate.memberKeys ?? {}).length} Senate seats and ${senate.rollCalls.length} recent Senate roll calls (${range(senate.rollCalls)}). ` : ""}These are selected recent votes, not full voting histories.`,
    ],
    [
      "State legislatures",
      "Rosters: every state and D.C.",
      `Current members of all 50 state legislatures come from Open States’ public roster and are matched to your address by district. Recorded votes: New York (official state sources)${statesWithVotes.length ? ` and ${statesWithVotes.length} other ${statesWithVotes.length === 1 ? "state" : "states"} (${statesWithVotes.join(", ")}) through Open States, ${stateVoteCount} floor votes in all, covering ${range(stateVotes.flatMap((s) => s.rollCalls))}` : ""}. For every other state a legislator’s page says plainly that recorded votes are not yet in our dataset. Open States vote data is a sample of the most recently acted-on bills; some votes date from earlier sessions.`,
    ],
    [
      "City councils",
      "New York City and Washington, D.C.",
      "NYC Council: roster and selected recorded votes. D.C. Council: roster from Open States; votes only where listed above. No other city, county or local body is covered.",
    ],
  ];

  return <main id="main-content" className="flex-1">
    <header className="border-b border-hairline"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4"><Wordmark /><Link href="/issues" className="text-sm font-semibold text-accent">Explore the votes →</Link></div></header>
    <div className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-xs font-bold uppercase tracking-widest text-accent">What is here. What is missing.</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold text-ink sm:text-5xl">A record you can inspect.</h1>
      <p className="mt-5 max-w-3xl text-base leading-relaxed text-ink-60">The Full Record combines selected roll-call snapshots (every member of Congress, New York bodies, and some other states’ legislatures) with researched candidate profiles. It is not a complete voting history. These counts and dates come directly from the snapshots currently included in this site.</p>
      <section aria-labelledby="by-place" className="mt-10">
        <h2 id="by-place" className="font-serif text-2xl font-semibold text-ink">Coverage by place</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-60">Who we can show for an address, and for whom we hold recorded votes. A missing vote record is a gap in our data, not evidence of inaction.</p>
        <dl className="mt-4 divide-y divide-hairline-soft border border-card bg-paper-raised">
          {places.map(([name, where, text]) => <div key={name} className="grid gap-1 p-5 md:grid-cols-[200px_1fr] md:gap-6">
            <dt><span className="font-serif text-lg font-semibold text-ink">{name}</span><span className="mt-0.5 block text-xs text-ink-60">{where}</span></dt>
            <dd className="text-sm leading-relaxed text-ink-60">{text}</dd>
          </div>)}
        </dl>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-60">Open States rosters can lag vacancies and special elections, and New Hampshire’s floterial House districts are not matched. Where a district matches no listed member we say so rather than guess.</p>
      </section>
      <h2 className="mt-10 font-serif text-2xl font-semibold text-ink">Vote snapshots by chamber</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {snapshots.map((s) => {
          const dates = s.rollCalls.map((r) => r.date).sort();
          return <section key={s.chamber} className="border border-card bg-paper-raised p-6">
            <h2 className="font-serif text-2xl font-semibold text-ink">{s.chamber}</h2>
            <p className="mt-3 text-sm"><strong className="font-mono text-2xl text-accent">{s.rollCalls.length}</strong> roll calls included</p>
            <dl className="mt-4 space-y-2 text-sm"><div className="flex flex-wrap justify-between gap-2"><dt className="text-ink-60">Vote dates</dt><dd>{dates.length ? `${date(dates[0])} – ${date(dates.at(-1)!)}` : "No records"}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt className="text-ink-60">Snapshot generated</dt><dd>{date(s.generatedAt)}</dd></div></dl>
            <p className="mt-4 border-t border-hairline pt-4 text-sm leading-relaxed text-ink-60">{NOTES[s.chamber] ?? (s.keyBy === "openstates" ? "Selected recent floor votes retrieved through Open States, drawn from the most recently acted-on bills. Not every vote in the session; voice votes and votes without identified members are excluded." : "Selected roll calls; coverage may be incomplete.")}</p>
            {s.rollCalls[0] && <a href={s.rollCalls[0].sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-xs font-semibold text-accent underline">Inspect a source record · {s.sourceLabel} ↗</a>}
          </section>;
        })}
      </div>
      <section className="mt-10 max-w-3xl space-y-5 text-sm leading-relaxed text-ink-60">
        <h2 className="font-serif text-2xl font-semibold text-ink">Read the limits alongside the results.</h2>
        <p><strong className="text-ink">A recent refresh is not complete coverage.</strong> The latest date varies by chamber. A gap in our records does not mean a representative was inactive, absent, or silent. Attendance figures describe only the roll calls we hold.</p>
        <p><strong className="text-ink">Topics help you find evidence.</strong> Issue filters use words in bill titles and summaries. They can miss relevant votes or include imperfect matches. They do not label a vote as supporting or opposing your beliefs. Search alternative terms and open the official record.</p>
        <p><strong className="text-ink">A vote is on a specific question.</strong> Procedural votes, amendments, confirmations, and final passage have different meanings. A bill passing one chamber does not by itself make it law. Large bills can contain several unrelated policies.</p>
        <p><strong className="text-ink">Candidate research is a separate collection.</strong> Profile records and selected key votes may cover other dates and are not counted in this snapshot inventory. Research depth varies. Check each race’s research date, notes, and cited sources.</p>
        <p><strong className="text-ink">We welcome corrections.</strong> <a href={`${REPO_URL}/issues`} className="text-accent underline">Report a problem</a> with the page URL and a primary source. Our <Link href="/guide/methodology" className="text-accent underline">research methodology</Link> explains source selection and AI-assisted summaries.</p>
      </section>
    </div>
  </main>;
}
