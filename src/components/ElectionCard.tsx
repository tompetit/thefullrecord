import type { SeatElection, SeatNotOnBallot } from "@/server/types";
import { SourceLink } from "./SourceLink";

const isOnBallot = (e: SeatElection | SeatNotOnBallot): e is SeatElection =>
  "candidates" in e;

/**
 * The seat's next election: the 2026 general-election slate (including who
 * ran in the primary and wasn't nominated), or when the seat is next on
 * the ballot. Party lines are neutral text chips — never interface color.
 */
export function ElectionCard({
  election,
}: {
  election: SeatElection | SeatNotOnBallot;
}) {
  if (!isOnBallot(election)) {
    return (
      <section className="mt-4 rounded-[10px] border border-card bg-paper-raised p-4">
        <h2 className="font-sans text-[11px] font-bold tracking-[0.06em] text-ink-45">
          THIS SEAT
        </h2>
        <p className="mt-1.5 font-sans text-[12.5px] leading-normal text-ink-60">
          Not on the 2026 ballot — next regular election in{" "}
          {election.nextElectionLabel}.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-[10px] border border-card bg-paper-raised p-4">
      <h2 className="font-sans text-[11px] font-bold tracking-[0.06em] text-ink-45">
        ON THE BALLOT · {election.dateLabel.toUpperCase()}
      </h2>

      {election.candidates.length === 0 ? (
        <p className="mt-1.5 font-sans text-[12.5px] text-ink-60">
          {election.candidates.length === 0 &&
            (election.primaryNotNominated?.length
              ? "The general-election slate for this seat is not yet settled."
              : "Candidate list not yet verified for this seat.")}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {election.candidates.map((c) => (
            <li
              key={c.name}
              className="flex flex-wrap items-center gap-1.5 font-sans text-[13px] text-ink-80"
            >
              <span className="font-serif text-[14px] font-bold text-ink">
                {c.name}
              </span>
              {c.parties.map((p) => (
                <span
                  key={p}
                  className="rounded-[3px] border border-chip-border px-1 text-[10.5px] font-semibold leading-normal"
                >
                  {p}
                </span>
              ))}
              {c.incumbent && (
                <span className="font-sans text-[10.5px] font-semibold tracking-[0.04em] text-ink-45">
                  INCUMBENT
                </span>
              )}
              {c.note && (
                <span className="basis-full font-sans text-[11px] leading-snug text-ink-45">
                  {c.note}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {election.primaryNotNominated && election.primaryNotNominated.length > 0 && (
        <div className="mt-3 border-t border-hairline-soft pt-2.5">
          <h3 className="font-sans text-[10.5px] font-bold tracking-[0.06em] text-ink-45">
            RAN IN THE JUNE PRIMARY · NOT NOMINATED
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {election.primaryNotNominated.map((c) => (
              <li
                key={c.name}
                className="flex flex-wrap items-center gap-1.5 font-sans text-xs text-ink-60"
              >
                {c.name}
                {c.parties.map((p) => (
                  <span
                    key={p}
                    className="rounded-[3px] border border-chip-border px-1 text-[10px] font-semibold leading-normal"
                  >
                    {p}
                  </span>
                ))}
                {c.note && (
                  <span className="basis-full font-sans text-[11px] leading-snug text-ink-45">
                    {c.note}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 font-sans text-[11px] text-ink-45">
        <SourceLink href={election.sourceUrl} className="text-[11px]">
          Candidate list · {election.sourceLabel}
        </SourceLink>
      </p>
    </section>
  );
}
