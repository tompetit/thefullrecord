import Link from "next/link";
import type { Official } from "@/server/types";
import { PartyChip } from "./PartyChip";

/** One official in the "Your representatives" list. Links to the profile. */
export function OfficialCard({ official, address = "" }: { official: Official; address?: string }) {
  return (
    <Link
      href={`/official/${official.id}${address ? `?address=${encodeURIComponent(address)}` : ""}`}
      className="flex items-start gap-3 rounded-[10px] border border-card bg-paper-raised p-4 shadow-card transition-shadow hover:shadow-card-raised"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-serif text-[16.5px] font-bold text-ink">
          {official.name}
        </span>
        <span className="flex flex-wrap items-center gap-1 font-sans text-xs text-ink-60">
          {official.role}
          {(official.party || official.partyLabel) && (
            <>
              {" "}
              · <PartyChip party={official.party ?? undefined} label={official.partyLabel} />
            </>
          )}
        </span>
        <span className="font-sans text-xs leading-[1.45] text-ink-80">
          {official.teaser.text}
        </span>
      </span>
      <span aria-hidden className="self-center text-[#c9c0ac] lg:hidden">
        ›
      </span>
    </Link>
  );
}
