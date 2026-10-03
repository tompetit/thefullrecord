"use client";

import Link from "next/link";
import { useAddress } from "./useAddress";

/** Secondary "back" link to the representatives list, keeping the saved address. */
export function RepsBackLink() {
  const { address } = useAddress();
  return (
    <Link
      href={address ? `/representatives?address=${encodeURIComponent(address)}` : "/representatives"}
      className="inline-flex min-h-11 items-center font-sans text-[12.5px] text-ink-60 hover:text-ink"
    >
      ‹ Your representatives
    </Link>
  );
}
