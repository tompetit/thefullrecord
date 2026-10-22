import Link from "@/components/Link";
import { AddressLookupForm } from "@/components/AddressLookupForm";
import { OfficialCard } from "@/components/OfficialCard";
import { SourceLink } from "@/components/SourceLink";
import { getDataSource } from "@/server/datasource";
import { LOOKUP_SCOPE, lookupMessage } from "@/lib/site";
import type { LookupContext } from "@/server/types";

export const metadata = {
  title: "Your representatives — The Full Record",
  description: "Find the officials who represent a U.S. address and see how they voted.",
};

function LookupNotes({ context }: { context: LookupContext }) {
  const lines: string[] = [];
  if (context.geographySource === "census-2026-fallback")
    lines.push(
      "We could not confirm today’s district boundaries, so these results use the districts for the November 2026 election. District boundaries may have changed, and the representatives listed could differ from your current representatives."
    );
  lines.push(...context.gaps, ...context.notes);
  const change = context.houseDistrictChange;
  if (!lines.length && !change) return null;
  return (
    <div className="mt-4 flex max-w-2xl flex-col gap-2 border border-hairline-soft bg-paper-raised p-4 font-sans text-[13px] leading-relaxed text-ink-60">
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
      <main className="mx-auto w-full max-w-7xl flex-1 pb-12">
        <div className="px-4 sm:px-6 pt-7 lg:px-10">
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

  const result = await ds.getOfficialsByAddress(address);

  if (!result.ok) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-1 pb-12">
        <div className="px-4 sm:px-6 pt-7 lg:px-10">
          <h1 className="font-serif text-[26px] font-semibold tracking-[-0.01em] text-ink lg:text-[32px]">
            Your representatives
          </h1>
          <p className="mt-4 max-w-lg border border-hairline-soft bg-paper-raised p-4 font-sans text-[13.5px] leading-relaxed text-ink-60">
            {lookupMessage(result.reason, address)}
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
    <main className="mx-auto w-full max-w-7xl flex-1 pb-12">
      <div className="px-4 sm:px-6 pt-7 lg:px-10">
        <h1 className="font-serif text-[26px] font-semibold tracking-[-0.01em] text-ink lg:text-[32px]">
          {isSample ? "Explore a sample district" : "Your representatives"}
        </h1>
        <p className="mt-1 font-sans text-[13.5px] text-ink-60">
          {count} representatives found for {result.matchedAddress}.
          {isSample && " This is an example address, not your location."}
        </p>
        <AddressLookupForm initialAddress={address} hint={false} />
        <p className="mt-4 max-w-2xl font-sans text-xs leading-relaxed text-ink-60">{LOOKUP_SCOPE} Missing records do not mean a representative took no action. <Link href="/coverage" className="underline hover:text-ink">See coverage by place</Link>.</p>
        {result.context?.state === "DC" && (
          <p className="mt-2 max-w-2xl font-sans text-xs leading-relaxed text-ink-60">D.C. has no U.S. senators; its House delegate can’t vote on final passage of bills.</p>
        )}
        {result.context && <LookupNotes context={result.context} />}
        <Link
          href={`/votes${address ? `?address=${encodeURIComponent(address)}` : ""}`}
          className="mt-4 inline-flex bg-ink px-4 py-2.5 font-sans text-[13.5px] font-semibold text-paper"
        >Explore their votes by issue →</Link>
        {address && count > 1 && (
          <Link
            href={`/votes?address=${encodeURIComponent(address)}&show=reps-split`}
            className="mt-4 ml-3 inline-flex min-h-11 items-center font-sans text-[13.5px] font-semibold text-accent-deep underline"
          >Votes where your representatives split →</Link>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-7 px-4 sm:px-6 lg:px-10">
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

      <p className="mt-8 px-4 font-sans text-xs text-ink-45 sm:px-6 lg:px-10">
        <SourceLink href="https://geocoding.geo.census.gov/" className="text-xs">
          How lookup works
        </SourceLink>
      </p>
    </main>
  );
}
