import Link from "next/link";
import type { Metadata } from "next";
import { IssueAddressForm } from "@/components/issues/IssueAddressForm";
import { IssueExplorer } from "@/components/issues/IssueExplorer";
import { LOOKUP_SCOPE } from "@/lib/site";
import { getDataSource } from "@/server/datasource";
import { getIssueRecords } from "@/server/issues";

export const metadata: Metadata = {
  title: "Explore the votes by issue — The Full Record",
  referrer: "no-referrer",
  description: "Start with housing, health, education or another issue. Explore recorded legislative votes and see how your representatives voted, with links to official records.",
};

const ERRORS = {
  "no-match": "We could not match that address. Include a street number, city and ZIP code, then try again.",
  "lookup-failed": "The address service is unavailable right now. Try again shortly; the records below are still available.",
};

export default async function IssuesPage({ searchParams }: { searchParams: Promise<{ address?: string | string[]; topic?: string | string[] }> }) {
  const params = await searchParams;
  const address = typeof params.address === "string" ? params.address.trim() : "";
  const invalidAddress = address.length > 300;
  const topic = typeof params.topic === "string" ? params.topic : "";
  const lookup = address && !invalidAddress ? await getDataSource().getOfficialsByAddress(address) : null;
  const officials = lookup?.ok ? lookup.groups.flatMap((group) => group.officials) : undefined;
  const { records, coverage } = getIssueRecords(officials);
  const dates = records.map((record) => record.date).sort();

  return <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 sm:px-6 lg:px-10">
    <section className="grid gap-8 border-b border-card py-9 sm:py-12 lg:grid-cols-[1.3fr_1fr] lg:gap-14">
      <div><p className="text-[11px] font-bold tracking-[0.16em] text-accent-deep">THE RECORD, BY ISSUE</p><h1 className="mt-4 max-w-xl font-serif text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">Start with what<br className="hidden sm:block" /> matters to you.</h1><p className="mt-5 max-w-lg text-base leading-relaxed text-ink-60">Housing. Health care. Your daily commute. Find the votes behind the issues, then read what your representatives actually did.</p><div className="mt-6 flex gap-6 border-t border-hairline pt-4"><div><p className="font-serif text-3xl font-semibold text-ink">{records.length}</p><p className="mt-1 text-[11px] text-ink-60">roll calls on file{officials ? " for these officials" : " across tracked chambers"}</p></div><div><p className="font-serif text-3xl font-semibold text-ink">{new Set(records.map((record) => record.chamber)).size}</p><p className="mt-1 text-[11px] text-ink-60">legislative chambers</p></div></div></div>
      <div className="self-start rounded-xl border border-card-strong bg-paper-raised p-5 sm:p-6"><p className="text-[11px] font-bold tracking-widest text-accent-deep">MAKE IT LOCAL</p><h2 className="mt-2 font-serif text-2xl font-semibold text-ink">How did your representatives vote?</h2><p className="mt-3 text-sm leading-relaxed text-ink-60">{LOOKUP_SCOPE}</p><IssueAddressForm key={address} initialAddress={address} /><p className="mt-3 text-[11px] leading-relaxed text-ink-60">No sign-up. Address lookup uses public geocoding services. The address appears in this page’s URL; remove it before sharing.</p></div>
    </section>
    {invalidAddress && <div role="alert" className="mt-6 rounded-lg border border-umber-tint-border bg-umber-tint p-4 text-sm leading-relaxed text-umber-deep">Please enter an address of 300 characters or fewer. Showing all tracked records until a valid address is submitted.</div>}
    {lookup && !lookup.ok && <div role="alert" className="mt-6 rounded-lg border border-umber-tint-border bg-umber-tint p-4 text-sm leading-relaxed text-umber-deep">{ERRORS[lookup.reason]} Showing all tracked records, not a local result.</div>}
    <div className="mt-6 rounded-lg border border-hairline bg-canvas/50 p-4 text-sm leading-relaxed text-ink-60">{lookup?.ok ? <><p className="font-semibold text-ink">Recorded votes for {lookup.matchedAddress}</p><p className="mt-1">{officials?.map((official) => official.name).join(" · ")}</p><p className="mt-2 text-xs">Only roll calls with an on-file position for at least one of these representatives appear below. Missing representatives or chambers can reflect incomplete district, roster or vote coverage. “Not voting” is a recorded non-vote, not a reason for the absence. <Link href="/issues" className="font-semibold text-accent-deep underline">Browse all tracked records</Link></p></> : <><strong className="text-ink">Browsing all tracked records.</strong> Add an address to see local representatives’ positions. Coverage includes every member of Congress, the New York State Legislature, the NYC Council, and selected votes from some other state legislatures; see the coverage page for details.</>}</div>
    <IssueExplorer key={`${address}:${topic}`} records={records} initialTopic={topic} local={Boolean(lookup?.ok)} address={lookup?.ok ? address : ""} />
    <section aria-labelledby="coverage-heading" className="mt-10 border-t border-card pt-7"><h2 id="coverage-heading" className="font-serif text-2xl font-semibold text-ink">A record you can check.</h2><p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-60">This is a selected snapshot, not a complete voting history. Records are ordered by date, not importance. Different chambers cover different time periods; counts are not a fair measure of how much an official has done. A “yes” or “no” answers the specific question voted on and is not an overall position on a topic.</p>{dates.length > 0 && <p className="mt-3 text-xs text-ink-60">Available records in this view: <time dateTime={dates[0]}>{dates[0]}</time> through <time dateTime={dates[dates.length - 1]}>{dates[dates.length - 1]}</time>.</p>}<div className="mt-5 overflow-x-auto rounded-lg border border-card"><table className="w-full text-left text-xs"><caption className="sr-only">Snapshot coverage by chamber across the full dataset</caption><thead className="bg-canvas text-ink-60"><tr><th scope="col" className="px-4 py-3 font-semibold">Chamber</th><th scope="col" className="px-4 py-3 font-semibold">Roll calls on file</th><th scope="col" className="px-4 py-3 font-semibold">Snapshot retrieved</th></tr></thead><tbody className="divide-y divide-hairline-soft">{coverage.map((item) => <tr key={item.chamber}><th scope="row" className="px-4 py-3 font-medium">{item.chamber}</th><td className="px-4 py-3 font-mono">{item.count}</td><td className="whitespace-nowrap px-4 py-3"><time dateTime={item.updated}>{item.updated}</time></td></tr>)}</tbody></table></div><p className="mt-4 text-xs"><Link href="/coverage" className="font-semibold text-accent-deep underline">See full data coverage and sourcing →</Link></p><details className="mt-5 text-xs text-ink-60"><summary className="min-h-11 cursor-pointer font-semibold text-accent-deep">How topic discovery works</summary><p className="max-w-3xl leading-relaxed">Topic tags match whole words or phrases in the ingested title, summary and vote question. They are automatically assigned and may miss relevant votes or include a tangential reference. Selecting multiple topics shows votes matching any selected topic. Topics overlap, so their counts should not be added together. Procedural and substantive votes remain distinct. Open the official record to check the question, bill text, chamber result and individual member votes. No topic selections are used to rank candidates or score ideological agreement.</p></details></section>
  </main>;
}
