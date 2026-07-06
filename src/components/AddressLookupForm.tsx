"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Glyph } from "./Glyph";
import { useAddress } from "./useAddress";

/** The home-page address form: saves the address and runs the live lookup. */
export function AddressLookupForm() {
  const router = useRouter();
  const { setAddress } = useAddress();
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const address = value.trim();
    if (address) setAddress(address);
    router.push(
      address
        ? `/representatives?address=${encodeURIComponent(address)}`
        : "/representatives"
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 flex max-w-md flex-col gap-2.5 lg:flex-row">
      <label className="flex flex-1 items-center gap-2 rounded-[10px] border-[1.5px] border-ink bg-paper-raised px-4 py-[15px]">
        <Glyph name="target" className="text-[15px] text-ink-45" />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Your street address"
          autoComplete="street-address"
          className="w-full bg-transparent font-sans text-[15px] text-ink outline-none placeholder:text-ink-35"
        />
      </label>
      <button
        type="submit"
        className="min-h-11 cursor-pointer rounded-[10px] bg-ink px-6 py-[15px] font-sans text-[15px] font-bold text-paper hover:opacity-90"
      >
        Find my representatives
      </button>
    </form>
  );
}
