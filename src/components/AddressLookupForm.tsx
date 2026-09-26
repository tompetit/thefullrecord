"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Glyph } from "./Glyph";
import { useAddress } from "./useAddress";
import type { AddressSuggestion } from "@/server/live/suggest";

const DEBOUNCE_MS = 200;

/**
 * The home-page address form: saves the address and runs the live lookup.
 * Typing offers New York address suggestions (keyless — see /api/address-suggest);
 * free text still works if nothing is picked.
 */
export function AddressLookupForm({ initialAddress = "" }: { initialAddress?: string }) {
  const router = useRouter();
  const { setAddress } = useAddress();
  const listId = useId();
  const [value, setValue] = useState(initialAddress);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Skip fetching for a value we just filled in from a suggestion.
  const picked = useRef<string | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 3 || q === picked.current) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/address-suggest?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { suggestions: AddressSuggestion[] };
        if (ctrl.signal.aborted || !Array.isArray(data.suggestions)) return;
        setSuggestions(data.suggestions);
        setActive(-1);
        setOpen(true);
      } catch {
        // Aborted or offline — suggestions are optional.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value]);

  function go(raw: string) {
    const address = raw.trim();
    if (!address) return;
    setAddress(address);
    router.push(
      address
        ? `/representatives?address=${encodeURIComponent(address)}`
        : "/representatives"
    );
  }

  function pick(s: AddressSuggestion) {
    picked.current = s.address;
    setValue(s.address);
    setOpen(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (open && active >= 0 && suggestions[active]) return go(suggestions[active].address);
    go(value);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && suggestions.length > 0;

  return (
    <div>
    <form onSubmit={submit} className="mt-6 flex max-w-md flex-col gap-2.5 lg:flex-row">
      <div className="relative flex-1">
        <label className="flex items-center gap-2 rounded-[10px] border-[1.5px] border-ink bg-paper-raised px-4 py-[15px]">
          <Glyph name="target" className="text-[15px] text-ink-45" />
          <input
            type="text"
            required
            maxLength={250}
            aria-label="Street address, city, and ZIP code"
            aria-describedby={`${listId}-privacy`}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
            value={value}
            onChange={(e) => {
              picked.current = null;
              setValue(e.target.value);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            onBlur={() => setOpen(false)}
            placeholder="Your street address"
            autoComplete="off"
            className="w-full bg-transparent font-sans text-[15px] text-ink outline-none placeholder:text-ink-35"
          />
        </label>
        {showList && (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-0 top-full z-20 mt-1.5 w-full lg:w-[22rem] overflow-hidden rounded-[10px] border border-chip-border bg-paper-raised shadow-[0_8px_24px_rgba(33,30,25,0.12)]"
          >
            {suggestions.map((s, i) => (
              <li
                key={s.address}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown, not click: fires before the input's blur closes the list
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-4 py-2.5 font-sans ${
                  i === active ? "bg-canvas" : ""
                }`}
              >
                <div className="text-[14px] text-ink">{s.address.split(",")[0]}</div>
                <div className="text-[12px] text-ink-45">{s.detail}</div>
              </li>
            ))}
            {suggestions.some((s) => s.source === "osm") && (
              <li
                aria-hidden
                className="border-t border-hairline-soft px-4 py-1.5 font-sans text-[10.5px] text-ink-45"
              >
                Suggestions © OpenStreetMap contributors
              </li>
            )}
          </ul>
        )}
      </div>
      <button
        type="submit"
        className="min-h-11 cursor-pointer rounded-[10px] bg-ink px-6 py-[15px] font-sans text-[15px] font-bold text-paper hover:opacity-90"
      >
        Find my representatives
      </button>
    </form>
    <p id={`${listId}-privacy`} className="mt-3 max-w-lg font-sans text-xs leading-relaxed text-ink-60">
      New York addresses only. Include your city or ZIP code; no apartment number needed. Your address is kept for this tab’s session and sent to public address services for lookup. It also appears in the results URL.
    </p>
    </div>
  );
}
