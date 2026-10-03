import Link from "next/link";
import { AddressLookupForm } from "@/components/AddressLookupForm";
import { OfficialCard } from "@/components/OfficialCard";
import { SourceLink } from "@/components/SourceLink";
import { getDataSource } from "@/server/datasource";
import type { LookupContext } from "@/server/types";

export const metadata = { title: "Your representatives — The Full Record" };

const LOOKUP_MESSAGES: Record<string, string> = {
  "no-match":
    "We couldn't match that address. Check the street number and spelling, and include the city or ZIP code.",
  "lookup-failed":
    "The district lookup service didn't respond. Try again in a moment.",
};

function LookupNotes({ context }: { context: LookupContext }) {
  const lines: string[] = [];
  if (context.geographySource === "census-2026-fallback")
    lines.push(
      "We could not confirm today’s district boundaries, so these results use the districts for the November 2026 election. District boundaries may have changed, and the officials listed could differ from your current representatives."
    );
  lines.push(...context.gaps, ...context.notes);
  const change = context.houseDistrictChange;
  if (!lines.length && !change) return null;
  return (
    <div className="mt-4 flex max-w-2xl flex-col gap-2 rounded-lg border border-hairline-soft bg-paper-raised p-4 font-sans text-[13px] leading-relaxed text-ink-60">
      {change && (
        <p>
          Your district changes for the Nov 3, 2026 election: you’ll vote in the {change.ballotLabel} race (your current representative serves {change.currentLabel}).{" "}
          <Link href={`/guide/race/${change.ballotSeat}`} className="font-semibold text-accent-deep underline">
            See the {change.ballotLabel} race →
          </Link>
        </p>
      )}
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

export default async function RepresentativesPage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string; sample?: string }>;
}) {
  const query = await searchParams;
  const address = typeof query.address === "string" ? query.address.trim().slice(0, 250) : "";
  const isSample = !address;
  const ds = getDataSource();

  // No address: just the form and a link to a sample district.
  if (isSample && query.sample !== "1") {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 pb-12">
        <div className="px-[26px] pt-7 lg:px-10">
          <h1 className="font-serif text-[26px] font-semibold tracking-[-0.01em] text-ink lg:text-[32px]">
            Your representatives
          </h1>
          <AddressLookupForm />
          <Link
            href="/representatives?sample=1"
            className="mt-3 inline-flex min-h-11 items-center font-sans text-[13.5px] text-ink-60 underline hover:text-ink"
          >
            See an example
          </Link>
        </div>
      </main>
    );
  }
  const [result, stats] = await Promise.all([
    ds.getOfficialsByAddress(address),
    ds.getSiteStats(),
  ]);

  if (!result.ok) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 pb-12">
        <div className="px-[26px] pt-7 lg:px-10">
          <h1 className="font-serif text-[26px] font-semibold tracking-[-0.01em] text-ink lg:text-[32px]">
            Your representatives
          </h1>
          <p className="mt-4 max-w-lg rounded-lg border border-hairline-soft bg-paper-raised p-4 font-sans text-[13.5px] leading-relaxed text-ink-60">
            {LOOKUP_MESSAGES[result.reason]}
          </p>
          <AddressLookupForm initialAddress={address} />
          <p className="mt-4 font-sans text-[13px]">
            <Link href="/" className="text-ink-60 underline hover:text-ink">
              ‹ Try another address
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const count = result.groups.reduce((n, g) => n + g.officials.length, 0);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 pb-12">
      <div className="px-[26px] pt-7 lg:px-10">
        <h1 className="font-serif text-[26px] font-semibold tracking-[-0.01em] text-ink lg:text-[32px]">
          {isSample ? "Explore a sample district" : "Your representatives"}
        </h1>
        <p className="mt-1 font-sans text-[13.5px] text-ink-60">
          {count} officials found for {result.matchedAddress}.
          {isSample && " This is an example address, not your location."}
        </p>
        <AddressLookupForm initialAddress={address} />
        <p className="mt-4 font-sans text-xs leading-relaxed text-ink-60">Coverage includes U.S. Congress and state legislators for any U.S. address, plus the NYC Council and the D.C. Council. Mayors, county offices and other local bodies are not included. Recorded votes are in our dataset for every member of Congress and for New York officials; other states’ legislators appear with their rosters, and some have selected votes (<Link href="/coverage" className="underline hover:text-ink">see coverage by place</Link>). Missing records do not mean an official took no action.</p>
        {result.context && <LookupNotes context={result.context} />}
        <Link
          href={`/issues${address ? `?address=${encodeURIComponent(address)}` : ""}`}
          className="mt-4 mr-3 inline-flex rounded-[10px] bg-ink px-4 py-2.5 font-sans text-[13.5px] font-semibold text-paper"
        >Explore the votes by issue →</Link>
        <Link
          href={`/guide/ballot?address=${encodeURIComponent(result.matchedAddress)}`}
          className="mt-4 inline-flex rounded-[10px] border-[1.5px] border-accent bg-accent-tint px-4 py-2.5 font-sans text-[13.5px] font-semibold text-accent-deep hover:bg-paper-raised"
        >
          Explore election information for this address →
        </Link>
      </div>

      <div className="mt-6 flex flex-col gap-7 px-[26px] lg:px-10">
        {result.groups.map((group) => (
          <section
            key={group.level}
            className="border-t border-hairline-soft pt-5 lg:grid lg:grid-cols-[180px_1fr] lg:gap-6"
          >
            <h2 className="mb-3 font-sans text-[11px] font-bold tracking-[0.08em] text-ink-45 lg:sticky lg:top-4 lg:mb-0 lg:self-start">
              {group.label}
            </h2>
            <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2">
              {group.officials.map((official) => (
                <OfficialCard key={official.id} official={official} address={address} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-8 px-[26px] font-sans text-xs leading-normal text-ink-45 lg:px-10">
        Districts resolved with the U.S. Census Geocoder and TIGERweb district
        boundaries (plus NYC Planning boundaries for the NYC Council).{" "}
        {(!result.context || result.context.state === "NY") && <>{stats.provenanceLine}. </>}
        <SourceLink href="https://geocoding.geo.census.gov/" className="text-xs">
          How lookup works
        </SourceLink>
      </p>
    </main>
  );
}
