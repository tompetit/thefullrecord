import Link from "@/components/Link";
import { PartyChip } from "@/components/PartyChip";
import { PartyChips } from "@/components/guide/ui";
import { PersonPhoto } from "@/components/PersonPhoto";
import { ballotLabel, partyChipProps } from "@/lib/people";
import { stateName } from "@/lib/usStates";
import type { Person } from "@/server/people";

/** One person in the directory and in "other candidates" lists. */
export function PersonCard({ person }: { person: Person }) {
  const office = person.offices?.[0];
  const run = person.candidacies?.[0];
  return (
    <Link
      href={`/people/${person.slug}`}
      className="flex h-full min-h-11 items-start gap-3 rounded-[10px] border border-card bg-paper-raised p-3.5 shadow-card transition-shadow hover:shadow-card-raised"
    >
      <PersonPhoto name={person.name} url={person.photo?.url} size={48} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-serif text-[16px] font-bold leading-tight text-ink">{person.name}</span>
        <span className="flex flex-wrap items-center gap-1 font-sans text-xs text-ink-60">
          {office ? (
            <>
              {office.role}
              {person.party && <PartyChip {...partyChipProps(person.party)} />}
            </>
          ) : (
            run && (
              <>
                Candidate
                <PartyChips parties={run.parties} />
              </>
            )
          )}
        </span>
        {office && run && <span className="font-sans text-xs text-ink-80">Also on the 2026 ballot: {ballotLabel(run, person.state)}</span>}
        {!office && run && <span className="font-sans text-xs text-ink-80">{ballotLabel(run, person.state)}</span>}
        <span className="font-sans text-[11.5px] text-ink-45">{stateName(person.state)}</span>
      </span>
    </Link>
  );
}
