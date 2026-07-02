"use client";

import Link from "next/link";
import { Wordmark } from "./Wordmark";
import { useAddress } from "./useAddress";

/**
 * Screen header — wordmark + the saved-address chip with its "Change"
 * affordance (present wherever the address is shown).
 */
export function AppHeader({ backHref, backLabel }: { backHref?: string; backLabel?: string }) {
  const { address } = useAddress();
  return (
    <header className="flex items-center justify-between gap-4 px-[26px] pt-4 lg:px-10 lg:pt-5">
      {backHref ? (
        <Link
          href={backHref}
          className="flex min-h-11 items-center font-sans text-[12.5px] text-ink-60 hover:text-ink"
        >
          ‹ {backLabel ?? "Back"}
        </Link>
      ) : (
        <Wordmark />
      )}
      <div className="flex min-h-11 items-center gap-1 font-sans text-xs text-ink-60">
        <span className="truncate max-w-52 sm:max-w-none">{address}</span>
        <span>·</span>
        <Link href="/" className="underline hover:text-ink">
          Change
        </Link>
      </div>
    </header>
  );
}
