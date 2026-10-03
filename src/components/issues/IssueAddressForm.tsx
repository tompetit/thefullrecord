"use client";

import { useState } from "react";
import { AddressInput } from "../AddressInput";

/**
 * The /issues address form — a plain GET form (works without JavaScript).
 * IssueExplorer attaches its topic/filter inputs with form="issue-address-form",
 * so the id and the `address` field name are part of the contract.
 */
export function IssueAddressForm({ initialAddress = "" }: { initialAddress?: string }) {
  const [value, setValue] = useState(initialAddress);
  return (
    <form id="issue-address-form" action="/issues" className="mt-5">
      <label htmlFor="issue-address" className="text-xs font-semibold text-ink-80">
        Street address, city and ZIP code
      </label>
      <div className="mt-2 flex">
        <AddressInput
          id="issue-address"
          name="address"
          value={value}
          onValueChange={setValue}
          maxLength={300}
          placeholder="123 Main St, Albany, NY 12207"
          fieldClassName="min-h-12 rounded-lg border border-chip-border bg-paper px-3"
          inputClassName="text-sm"
        />
      </div>
      <button
        type="submit"
        className="mt-3 min-h-12 w-full cursor-pointer rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-deep"
      >
        Find my representatives’ votes →
      </button>
    </form>
  );
}
