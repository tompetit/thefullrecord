import Link from "next/link";
import { AddressLookupForm } from "@/components/AddressLookupForm";
import { AppHeader } from "@/components/AppHeader";
import { OfficialCard } from "@/components/OfficialCard";
import { SourceLink } from "@/components/SourceLink";
import { getDataSource } from "@/server/datasource";

export const metadata = { title: "Your representatives — The Full Record" };

const LOOKUP_MESSAGES: Record<string, string> = {
  "no-match":
    "We couldn't match that address. Check the street number and spelling, and include the city or ZIP code.",
  "outside-ny":
    "That address matched, but it's outside New York — The Full Record currently covers New York representation only.",
  "lookup-failed":
    "The district lookup service didn't respond. Try again in a moment.",
};

export default async function RepresentativesPage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const query = await searchParams;
  const address = typeof query.address === "string" ? query.address.trim().slice(0, 250) : "";
  const isSample = !address;
  const ds = getDataSource();
  const [result, stats] = await Promise.all([
    ds.getOfficialsByAddress(address),
    ds.getSiteStats(),
  ]);

  if (!result.ok) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 pb-12">
        <AppHeader />
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
      <AppHeader />

      <div className="px-[26px] pt-7 lg:px-10">
        <h1 className="font-serif text-[26px] font-semibold tracking-[-0.01em] text-ink lg:text-[32px]">
          {isSample ? "Explore a sample district" : "Your representatives"}
        </h1>
        <p className="mt-1 font-sans text-[13.5px] text-ink-60">
          {count} officials found for {result.matchedAddress}.
          {isSample && " This is an example address, not your location."}
        </p>
        <AddressLookupForm initialAddress={address} />
        <p className="mt-4 font-sans text-xs leading-relaxed text-ink-60">Coverage includes federal and New York state legislators, plus NYC Council members where available. Local offices outside NYC are not included. Missing records do not mean an official took no action.</p>
        <Link
          href={`/issues${address ? `?address=${encodeURIComponent(address)}` : ""}`}
          className="mt-4 mr-3 inline-flex rounded-[10px] bg-ink px-4 py-2.5 font-sans text-[13.5px] font-semibold text-paper"
        >Explore votes by issue →</Link>
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
        Districts resolved with the U.S. Census Geocoder and NYC Planning
        district boundaries. {stats.provenanceLine}.{" "}
        <SourceLink href="https://geocoding.geo.census.gov/" className="text-xs">
          How lookup works
        </SourceLink>
      </p>
    </main>
  );
}
