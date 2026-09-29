"use client";

import Link from "next/link";
import { Wordmark } from "./Wordmark";
import { useAddress } from "./useAddress";

/**
 * Screen header — wordmark + the saved-address chip with its "Change"
 * affordance (present wherever the address is shown).
 */
export function AppHeader({ backHref, backLabel }: { backHref?: string; backLabel?: string }) {
  const { address, clearAddress } = useAddress();
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
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs text-ink-60">
        <Link href={address ? `/issues?address=${encodeURIComponent(address)}` : "/issues"} className="inline-flex min-h-11 items-center font-semibold text-accent hover:underline">Explore votes</Link>
        {address ? <>
          <span className="max-w-44 truncate" title={address}>{address}</span>
          <Link href="/" className="inline-flex min-h-11 items-center underline hover:text-ink">Change</Link>
          <button type="button" onClick={clearAddress} className="min-h-11 cursor-pointer underline hover:text-ink">Clear address</button>
        </> : <Link href="/#find-your-reps" className="inline-flex min-h-11 items-center underline hover:text-ink">Find my representatives</Link>}
      </div>
    </header>
  );
}
