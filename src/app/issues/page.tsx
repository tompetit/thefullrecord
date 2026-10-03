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
  const { records } = getIssueRecords(officials);

  return <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 sm:px-6 lg:px-10">
    <section className="grid gap-8 border-b border-card py-9 sm:py-12 lg:grid-cols-[1.3fr_1fr] lg:gap-14">
      <div><p className="text-[11px] font-bold tracking-[0.16em] text-accent-deep">THE RECORD, BY ISSUE</p><h1 className="mt-4 max-w-xl font-serif text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">Start with what<br className="hidden sm:block" /> matters to you.</h1><p className="mt-5 max-w-lg text-base leading-relaxed text-ink-60">Housing. Health care. Your daily commute. Find the votes behind the issues, then read what your representatives actually did.</p></div>
      <div className="self-start rounded-xl border border-card-strong bg-paper-raised p-5 sm:p-6"><p className="text-[11px] font-bold tracking-widest text-accent-deep">MAKE IT LOCAL</p><h2 className="mt-2 font-serif text-2xl font-semibold text-ink">How did your representatives vote?</h2><p className="mt-3 text-sm leading-relaxed text-ink-60">{LOOKUP_SCOPE}</p><IssueAddressForm key={address} initialAddress={address} /><p className="mt-3 text-[11px] leading-relaxed text-ink-60">No sign-up. Address lookup uses public geocoding services. The address appears in this page’s URL; remove it before sharing.</p></div>
    </section>
    {invalidAddress && <div role="alert" className="mt-6 rounded-lg border border-umber-tint-border bg-umber-tint p-4 text-sm leading-relaxed text-umber-deep">Please enter an address of 300 characters or fewer. Showing all tracked records until a valid address is submitted.</div>}
    {lookup && !lookup.ok && <div role="alert" className="mt-6 rounded-lg border border-umber-tint-border bg-umber-tint p-4 text-sm leading-relaxed text-umber-deep">{ERRORS[lookup.reason]} Showing all tracked records, not a local result.</div>}
    {lookup?.ok && <div className="mt-6 rounded-lg border border-hairline bg-canvas/50 p-4 text-sm leading-relaxed text-ink-60"><><p className="font-semibold text-ink">Recorded votes for {lookup.matchedAddress}</p><p className="mt-1">{officials?.map((official) => official.name).join(" · ")}</p><p className="mt-2 text-xs">Only roll calls with an on-file position for at least one of these representatives appear below. Missing representatives or chambers can reflect incomplete district, roster or vote coverage. “Not voting” is a recorded non-vote, not a reason for the absence.</p></></div>}
    <IssueExplorer key={`${address}:${topic}`} records={records} initialTopic={topic} local={Boolean(lookup?.ok)} address={lookup?.ok ? address : ""} />
    <p className="mt-10 text-sm"><Link href="/coverage" className="inline-flex min-h-11 items-center font-semibold text-accent-deep underline">See our data coverage →</Link></p>
  </main>;
}
