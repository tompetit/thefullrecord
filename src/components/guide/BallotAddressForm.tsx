"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { AddressInput } from "../AddressInput";
import { useAddress } from "../useAddress";

/**
 * Address → the voter's own ballot. Any U.S. address works for Congress, so
 * suggestions here use the nationwide scope.
 */
export function BallotAddressForm({
  target = "/guide/ballot",
  cta = "See my ballot",
}: {
  target?: string;
  cta?: string;
}) {
  const router = useRouter();
  const privacyId = useId();
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
    <div>
      <form onSubmit={submit} className="mt-6 flex max-w-xl flex-col gap-2.5 sm:flex-row">
        <AddressInput
          value={value}
          onValueChange={setValue}
          scope="us"
          label="Your street address"
          describedBy={privacyId}
          placeholder="Your street address, city, state"
          fieldClassName="rounded-[10px] border-[1.5px] border-ink bg-paper-raised px-4 py-3.5"
          inputClassName="text-[15px]"
        />
        <button
          type="submit"
          className="min-h-11 cursor-pointer rounded-[10px] bg-ink px-6 py-3.5 font-sans text-[15px] font-bold text-paper hover:opacity-90"
        >
          {cta}
        </button>
      </form>
      <p id={privacyId} className="mt-3 max-w-xl font-sans text-xs leading-relaxed text-ink-60">Your address is sent to public geocoding services to find districts and kept in this tab’s session. It appears in the results URL and may remain in browser history. No apartment number is needed.</p>
    </div>
  );
}
