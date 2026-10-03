"use client";

import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { AddressSuggestion } from "@/server/live/suggest";

const DEBOUNCE_MS = 200;
const MIN_CHARS = 3;

const CREDIT: Record<AddressSuggestion["source"], string> = {
  nyc: "NYC Planning",
  nys: "NYS GIS",
  census: "U.S. Census Bureau",
  osm: "© OpenStreetMap contributors",
};

/**
 * Street-address text field with keyless suggestions (/api/address-suggest),
 * as an ARIA 1.2 combobox: the list is announced, ArrowUp/Down move through
 * it, Enter or a click picks, Escape closes. Picking a suggestion fills the
 * field and submits its form right away (the pick is a complete address, so a
 * second click would only be busywork); free text still submits as typed.
 *
 * The parent form keeps its own submit behaviour — a client `onSubmit` reading
 * the controlled value, or a plain GET form reading the input's `name`.
 */
export function AddressInput({
  value,
  onValueChange,
  scope,
  id,
  name,
  form,
  label,
  describedBy,
  placeholder = "Your street address",
  required = true,
  maxLength = 250,
  leading,
  fieldClassName = "",
  inputClassName = "",
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** "us" for forms that accept any U.S. address; omit for the site's NY scope. */
  scope?: "us";
  id?: string;
  name?: string;
  form?: string;
  /** Accessible name when no visible <label htmlFor> points at `id`. */
  label?: string;
  describedBy?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  /** Decoration before the text (an icon). */
  leading?: React.ReactNode;
  /** Classes for the bordered field box. */
  fieldClassName?: string;
  inputClassName?: string;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Skip fetching for a value we just filled in from a suggestion.
  const picked = useRef<string | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < MIN_CHARS || q === picked.current) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, ...(scope ? { scope } : {}) });
        const res = await fetch(`/api/address-suggest?${params}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { suggestions: AddressSuggestion[] };
        if (ctrl.signal.aborted || !Array.isArray(data.suggestions)) return;
        setSuggestions(data.suggestions);
        setActive(-1);
        setOpen(document.activeElement === inputRef.current);
      } catch {
        // Aborted or offline — suggestions are optional.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value, scope]);

  function pick(s: AddressSuggestion) {
    picked.current = s.address;
    // Commit the new value before submitting so the form reads it.
    flushSync(() => {
      onValueChange(s.address);
      setOpen(false);
      setActive(-1);
    });
    inputRef.current?.form?.requestSubmit();
  }

  const showList = open && suggestions.length > 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!suggestions.length) return;
      e.preventDefault();
      if (!showList) {
        setOpen(true);
        setActive(e.key === "ArrowDown" ? 0 : suggestions.length - 1);
        return;
      }
      const n = suggestions.length;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
    } else if (e.key === "Enter" && showList && active >= 0 && suggestions[active]) {
      e.preventDefault();
      pick(suggestions[active]);
    } else if (e.key === "Escape" && showList) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  const credits = [...new Set(suggestions.map((s) => CREDIT[s.source]))];

  return (
    <div className="relative min-w-0 flex-1">
      <div
        className={`flex items-center gap-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${fieldClassName}`}
      >
        {leading}
        <input
          ref={inputRef}
          id={id}
          name={name}
          form={form}
          type="text"
          required={required}
          maxLength={maxLength}
          aria-label={label}
          aria-describedby={describedBy}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          value={value}
          onChange={(e) => {
            picked.current = null;
            onValueChange(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          className={`w-full min-w-0 bg-transparent font-sans text-ink outline-none placeholder:text-ink-35 ${inputClassName}`}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {showList ? `${suggestions.length} address suggestion${suggestions.length === 1 ? "" : "s"}. Use the up and down arrows to review, Enter to choose.` : ""}
      </p>
      <div
        hidden={!showList}
        className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-[10px] border border-chip-border bg-paper-raised text-left shadow-[0_8px_24px_rgba(33,30,25,0.14)] lg:right-auto lg:w-[max(100%,24rem)]"
      >
        <ul id={listId} role="listbox" aria-label="Address suggestions">
          {suggestions.map((s, i) => {
            const [street, ...rest] = s.address.split(",");
            return (
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
                onMouseMove={() => i !== active && setActive(i)}
                className={`flex min-h-11 cursor-pointer flex-col justify-center border-l-[3px] px-4 py-2 font-sans ${
                  i === active ? "border-accent bg-accent-tint" : "border-transparent"
                }`}
              >
                <span className="text-[14px] text-ink">{street}</span>
                <span className="text-[12px] text-ink-60">{s.detail || rest.join(",").trim()}</span>
              </li>
            );
          })}
        </ul>
        {credits.length > 0 && (
          <p className="border-t border-hairline-soft px-4 py-1.5 font-sans text-[10.5px] text-ink-60">
            Suggestions: {credits.join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}
