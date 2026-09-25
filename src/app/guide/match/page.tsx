import { BallotAddressForm } from "@/components/guide/BallotAddressForm";
import { Matcher } from "@/components/guide/Matcher";
import { ALL_STATES, stateName } from "@/components/guide/RaceView";
import { GuideFooter, GuideNav } from "@/components/guide/ui";
import { ballotForAddress, ballotForDistrict } from "@/server/guide/ballot";
import type { GuideRace } from "@/server/guide/types";

export const metadata = {
  title: "What matters to me — The Full Record",
  description:
    "Tell us where you live and what you care about. See how the candidates on your ballot line up — using only positions documented in cited sources.",
};

type SP = Promise<{ address?: string; state?: string; cd?: string }>;

export default async function MatchPage({ searchParams }: { searchParams: SP }) {
  const { address, state, cd } = await searchParams;
  let races: GuideRace[] | null = null;
  let placeLabel = "";
  let error: string | null = null;

  if (address) {
    const result = await ballotForAddress(address);
    if (result.ok) {
      races = result.races;
      placeLabel = result.matchedAddress;
    } else {
      error =
        result.reason === "no-match"
          ? "We couldn't match that address — include the street number, city, and state."
          : "The district lookup didn't respond. Try again, or pick your state and district below.";
    }
  } else if (state) {
    const st = state.toUpperCase();
    races = ballotForDistrict(st, cd || null);
    placeLabel = `${stateName(st)}${cd ? `, District ${cd}` : ""}`;
  }

  return (
    <main className="flex-1">
      <GuideNav active="match" />
      <div className="mx-auto w-full max-w-6xl px-[20px] pt-8 lg:px-10">
        <p className="font-sans text-[11px] font-bold tracking-[0.1em] text-accent">I LIVE HERE · THIS IS WHAT I CARE ABOUT</p>
        <h1 className="mt-2 font-serif text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] text-ink lg:text-[42px]">
          What matters to me
        </h1>
        {!races && (
          <>
            <p className="mt-2 max-w-2xl font-sans text-[14.5px] leading-[1.6] text-ink-60">
              Start with where you vote. We&rsquo;ll pull up every race on your
              ballot, you tell us where you stand, and we show how each
              candidate&rsquo;s documented record lines up — with the source for
              every position.
            </p>
            {error && (
              <p className="mt-4 max-w-lg rounded-lg border border-hairline-soft bg-paper-raised p-3 font-sans text-[13px] text-ink-60">{error}</p>
            )}
            <BallotAddressForm target="/guide/match" cta="Start" />
            <form action="/guide/match" className="mt-6 flex max-w-xl flex-wrap items-end gap-2 font-sans text-[13px] text-ink-80">
              <span className="basis-full text-[12px] text-ink-45">Or pick your state and congressional district:</span>
              <select name="state" required defaultValue="" className="rounded-md border border-chip-border bg-paper-raised px-2 py-2">
                <option value="" disabled>State</option>
                {ALL_STATES.map((s) => (
                  <option key={s} value={s}>{stateName(s)}</option>
                ))}
              </select>
              <input name="cd" placeholder="District # (blank = at-large / Senate only)" className="w-72 rounded-md border border-chip-border bg-paper-raised px-2 py-2" />
              <button className="cursor-pointer rounded-md bg-ink px-4 py-2 font-bold text-paper">Go</button>
            </form>
          </>
        )}
        {races && (
          <>
            <p className="mt-2 font-sans text-[14px] text-ink-60">
              Your ballot: {placeLabel} · {races.length} researched{" "}
              {races.length === 1 ? "contest" : "contests"} ·{" "}
              <a href="/guide/match" className="underline hover:text-ink">change</a>
            </p>
            <Matcher races={races} placeLabel={placeLabel} />
          </>
        )}
      </div>
      <GuideFooter />
    </main>
  );
}
