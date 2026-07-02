import type { RollCall } from "@/server/types";
import { Glyph, VOTE_GLYPH } from "./Glyph";
import { SourceLink } from "./SourceLink";

/**
 * Full roll call — outcome, stacked Yes/No bar, tallies, member rows,
 * and the truncation line with running counts.
 */
export function RollCallCard({
  rollCall,
  desktop = false,
}: {
  rollCall: RollCall;
  desktop?: boolean;
}) {
  const voted = rollCall.yes + rollCall.no;
  const yesPct = voted ? (rollCall.yes / voted) * 100 : 0;

  return (
    <section className="rounded-lg border border-card bg-paper-raised p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-sans text-[11px] font-bold tracking-[0.06em] text-ink-45">
          FULL ROLL CALL · {rollCall.dateLabel}
        </h3>
        <span className="font-sans text-xs font-semibold text-ink-80">
          {rollCall.outcome}
        </span>
      </div>

      <div className="mt-3 flex h-2 overflow-hidden rounded-full">
        <span className="bg-accent" style={{ width: `${yesPct}%` }} />
        <span className="flex-1 bg-sand" />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-sans text-xs text-ink-60">
        <span className="inline-flex items-center gap-1 font-semibold text-accent-deep">
          <Glyph name="check" /> Yes {rollCall.yes}
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-umber-deep">
          <Glyph name="cross" /> No {rollCall.no}
        </span>
        <span className="inline-flex items-center gap-1">
          <Glyph name="circle" /> Absent {rollCall.absent}
        </span>
      </div>

      <ul
        className={`mt-3 border-t border-hairline-soft pt-3 font-sans text-[12.5px] text-ink-80 ${
          desktop ? "grid grid-cols-2 gap-x-6" : "flex flex-col"
        }`}
      >
        {rollCall.members.map((m) => (
          <li
            key={m.name}
            className="flex items-center justify-between gap-2 py-1"
          >
            <span>
              {m.name} <span className="text-ink-45">({m.district})</span>
            </span>
            <span
              className={`inline-flex items-center gap-1 font-bold ${
                m.vote === "yes"
                  ? "text-accent-deep"
                  : m.vote === "no"
                    ? "text-umber-deep"
                    : "text-ink-45"
              }`}
            >
              <Glyph name={VOTE_GLYPH[m.vote]} />
              {m.vote === "yes" ? "Yes" : m.vote === "no" ? "No" : "Absent"}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2 border-t border-hairline-soft pt-3 font-sans text-xs text-ink-60">
        See all {rollCall.totalMembers} votes ·{" "}
        <SourceLink href={rollCall.sourceUrl}>Official roll call</SourceLink>
      </div>
    </section>
  );
}
