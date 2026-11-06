import Link from "@/components/Link";
import { SourceLink } from "@/components/SourceLink";
import { getRaceResult, resultsUpdatedAt, type RaceResult } from "@/server/guide/results";
import type { GuideRace } from "@/server/guide/types";

/** Neutral by design: a result is never shown in a party or Yes/No color. */
export function WonTag() {
  return <span className="rounded-[2px] bg-ink px-1 font-sans text-[10.5px] font-bold tracking-[0.05em] text-paper">PROJECTED WINNER</span>;
}

export const updatedLabel = () =>
  new Date(`${resultsUpdatedAt()}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/** One line for lists: who won, the measure's outcome, or why there's no call yet. */
export function resultHeadline(race: GuideRace, r: RaceResult): string {
  if (r.status === "runoff") return "Goes to a runoff";
  if (r.status === "uncalled") return r.unconfirmed ? "Result not confirmed yet" : "Not yet called";
  if (r.outcome) return r.outcome === "approved" ? "Approved" : "Rejected";
  const name = race.candidates.find((c) => c.id === r.winner)?.name;
  return name ? `${name}, projected winner` : "Winner projected";
}

export function RaceResultLine({ race }: { race: GuideRace }) {
  const r = getRaceResult(race.id);
  if (!r) return null;
  return <p className="mt-1 font-sans text-[12.5px] font-bold text-ink">{resultHeadline(race, r)}</p>;
}

export const isWinner = (race: GuideRace, candidateId: string) => {
  const r = getRaceResult(race.id);
  return r?.status === "projected" && r.winner === candidateId;
};

export function RaceResultPanel({ race }: { race: GuideRace }) {
  const r = getRaceResult(race.id);
  if (!r) return null;
  const rows = [...r.candidates].sort((a, b) => (b.votes ?? -1) - (a.votes ?? -1));
  return (
    <section aria-labelledby="result" className="mt-5 max-w-3xl border-[1.5px] border-ink bg-paper-raised p-4">
      <p className="font-sans text-[11px] font-bold tracking-[0.06em] text-ink-60">RESULT · UNOFFICIAL UNTIL CERTIFIED</p>
      <h2 id="result" className="mt-1 font-serif text-[22px] font-bold leading-tight text-ink">{resultHeadline(race, r)}</h2>
      {r.note && <p className="mt-1 font-sans text-[13.5px] leading-[1.55] text-ink-80">{r.note}</p>}
      {rows.some((c) => c.votes !== null || c.pct !== null) && (
        <table className="mt-3 w-full font-sans text-[13.5px] text-ink-80">
          <thead className="sr-only">
            <tr><th scope="col">Candidate</th><th scope="col">Votes</th><th scope="col">Share</th></tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {rows.map((c) => (
              <tr key={c.name}>
                <td className={`py-1.5 pr-3 ${c.id && c.id === r.winner ? "font-bold text-ink" : ""}`}>
                  {c.id && race.officeType !== "ballot-measure" ? <Link href={`/guide/race/${race.id}/${c.id}`} className="hover:underline">{c.name}</Link> : c.name}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono text-[12.5px]">{c.votes?.toLocaleString("en-US") ?? "—"}</td>
                <td className="py-1.5 text-right font-mono text-[12.5px]">{c.pct === null ? "—" : `${c.pct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 font-sans text-[12px] leading-[1.5] text-ink-60">
        {r.percentIn !== null && <>About {Math.round(r.percentIn)}% of the expected vote counted. </>}
        As of {updatedLabel()}. Winners take office next year, and counts can change until states certify.{" "}
        {r.sources.map((s) => <span key={s.url} className="mr-2 inline-block"><SourceLink href={s.url} className="text-[12px]">{s.label}</SourceLink></span>)}
      </p>
    </section>
  );
}
