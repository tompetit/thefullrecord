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
export default function CoveragePage() {
  const snapshots = getSnapshots();
  return <main id="main-content" className="flex-1">
    <header className="border-b border-hairline"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4"><Wordmark /><Link href="/issues" className="text-sm font-semibold text-accent">Explore the votes →</Link></div></header>
    <div className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-xs font-bold uppercase tracking-widest text-accent">What is here. What is missing.</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold text-ink sm:text-5xl">A record you can inspect.</h1>
      <p className="mt-5 max-w-3xl text-base leading-relaxed text-ink-60">The Full Record combines selected roll-call snapshots with researched candidate profiles. It is not a complete voting history. These counts and dates come directly from the snapshots currently included in this site.</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {snapshots.map((s) => {
          const dates = s.rollCalls.map((r) => r.date).sort();
          return <section key={s.chamber} className="border border-card bg-paper-raised p-6">
            <h2 className="font-serif text-2xl font-semibold text-ink">{s.chamber}</h2>
            <p className="mt-3 text-sm"><strong className="font-mono text-2xl text-accent">{s.rollCalls.length}</strong> roll calls included</p>
            <dl className="mt-4 space-y-2 text-sm"><div className="flex flex-wrap justify-between gap-2"><dt className="text-ink-60">Vote dates</dt><dd>{dates.length ? `${date(dates[0])} – ${date(dates.at(-1)!)}` : "No records"}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt className="text-ink-60">Snapshot generated</dt><dd>{date(s.generatedAt)}</dd></div></dl>
            <p className="mt-4 border-t border-hairline pt-4 text-sm leading-relaxed text-ink-60">{NOTES[s.chamber] ?? "Selected roll calls; coverage may be incomplete."}</p>
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
