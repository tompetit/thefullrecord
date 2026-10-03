import type { Party } from "@/server/types";

/**
 * Party label — a small conventional data chip, never an emotional
 * interface color (hard brand constraint: no red/blue).
 */
export function PartyChip({ party, label }: { party?: Party; label?: string }) {
  return (
    <span className="rounded-[3px] border border-chip-border px-1 text-[10.5px] font-semibold leading-normal">
      {party ?? label}
    </span>
  );
}
