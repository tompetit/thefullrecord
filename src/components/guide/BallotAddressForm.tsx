"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAddress } from "../useAddress";

/** Address → the voter's own ballot. Any U.S. address works for Congress. */
export function BallotAddressForm({
  target = "/guide/ballot",
  cta = "See my ballot",
}: {
  target?: string;
  cta?: string;
}) {
  const router = useRouter();
  const { setAddress } = useAddress();
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const address = value.trim();
    if (!address) return;
    setAddress(address);
    router.push(`${target}?address=${encodeURIComponent(address)}`);
  }

  return (
    <form onSubmit={submit} className="mt-6 flex max-w-xl flex-col gap-2.5 sm:flex-row">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Your street address, city, state"
        autoComplete="street-address"
        aria-label="Your street address"
        className="flex-1 rounded-[10px] border-[1.5px] border-ink bg-paper-raised px-4 py-3.5 font-sans text-[15px] text-ink outline-none placeholder:text-ink-35"
      />
      <button
        type="submit"
        className="min-h-11 cursor-pointer rounded-[10px] bg-ink px-6 py-3.5 font-sans text-[15px] font-bold text-paper hover:opacity-90"
      >
        {cta}
      </button>
    </form>
  );
}
