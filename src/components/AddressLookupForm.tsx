"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { AddressInput } from "./AddressInput";
import { Glyph } from "./Glyph";
import { useAddress } from "./useAddress";

/**
 * The representatives lookup form: saves the address and runs the live
 * lookup. Typing offers U.S. address suggestions (keyless — see
 * /api/address-suggest); free text still works if nothing is picked.
 */
export function AddressLookupForm({ initialAddress = "" }: { initialAddress?: string }) {
  const router = useRouter();
  const { address: saved, setAddress } = useAddress();
  const privacyId = useId();
  // Saved address shows once mounted (it is empty during SSR, so no mismatch).
  const [typed, setValue] = useState<string | null>(null);
  const value = typed ?? (initialAddress || saved);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const address = value.trim();
    if (!address) return;
    setAddress(address);
    router.push(`/representatives?address=${encodeURIComponent(address)}`);
  }

  return (
    <div>
      <form onSubmit={submit} className="mt-6 flex max-w-xl flex-col gap-2.5 lg:flex-row">
        <AddressInput
          value={value}
          onValueChange={setValue}
          label="Street address, city, and ZIP code"
          describedBy={privacyId}
          leading={<Glyph name="target" className="text-[15px] text-ink-45" />}
          fieldClassName="rounded-[10px] border-[1.5px] border-ink bg-paper-raised px-4 py-[15px]"
          inputClassName="text-[15px]"
        />
        <button
          type="submit"
          className="min-h-11 cursor-pointer rounded-[10px] bg-ink px-6 py-[15px] font-sans text-[15px] font-bold text-paper hover:opacity-90"
        >
          Find my representatives
        </button>
      </form>
      <p id={privacyId} className="mt-3 max-w-lg font-sans text-xs leading-relaxed text-ink-60">
        Any U.S. address. Include your city or ZIP code; no apartment number needed. Your address is kept for this tab’s session and sent to public address services for lookup. It also appears in the results URL.
      </p>
    </div>
  );
}
