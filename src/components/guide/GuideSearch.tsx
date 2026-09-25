"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface SearchRace {
  id: string;
  st: string;
  stName: string;
  o: string;
  t: string;
  a: string;
  nyc: boolean;
  c: Array<{ id: string; n: string; p: string[]; i: boolean; r?: string }>;
}

const OFFICES: Array<[string, string]> = [
  ["", "All offices"],
  ["us-senate", "U.S. Senate"],
  ["us-house", "U.S. House"],
  ["statewide", "Statewide NY"],
  ["state-senate", "State Senate"],
  ["state-assembly", "Assembly"],
  ["ballot-measure", "Ballot measures"],
];
const STATEWIDE = new Set(["governor", "attorney-general", "comptroller"]);

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ");

/** Client-side search over every race and candidate in the guide. */
export function GuideSearch({ races, initialQuery = "" }: { races: SearchRace[]; initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery);
  const [office, setOffice] = useState("");
  const [nycOnly, setNycOnly] = useState(false);

  const haystacks = useMemo(
    () =>
      races.map((r) => ({
        r,
        text: norm(
          [r.t, r.a, r.st, r.stName, r.id.replace(/-/g, " "), ...r.c.map((c) => `${c.n} ${c.p.join(" ")} ${c.r ?? ""}`)].join(" ")
        ),
      })),
    [races]
  );

  const results = useMemo(() => {
    const tokens = norm(q).split(/\s+/).filter(Boolean);
    return haystacks
      .filter(({ r, text }) => {
        if (office === "statewide" ? !STATEWIDE.has(r.o) : office && r.o !== office) return false;
        if (nycOnly && !r.nyc) return false;
        return tokens.every((t) => (/^\d+$/.test(t) ? new RegExp(`\\b${t}\\b`).test(text) : text.includes(t)));
      })
      .map(({ r }) => r);
  }, [haystacks, q, office, nycOnly]);

  const tokens = norm(q).split(/\s+/).filter(Boolean);
  const shown = results.slice(0, 60);

  return (
    <div>
      <label className="flex items-center gap-2 rounded-[10px] border-[1.5px] border-ink bg-paper-raised px-4 py-3.5">
        <svg viewBox="0 0 12 12" className="size-4 flex-none text-ink-45" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <circle cx="5" cy="5" r="3.6" />
          <path d="M7.7 7.7 L11 11" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a name, district, state, or neighborhood — e.g. “Lander”, “NY 10”, “Astoria”"
          className="w-full bg-transparent font-sans text-[15px] text-ink outline-none placeholder:text-ink-35"
          aria-label="Search races and candidates"
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 font-sans text-[12.5px]">
        {OFFICES.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setOffice(key)}
            className={`cursor-pointer rounded-full border px-3 py-1 ${
              office === key ? "border-ink bg-ink text-paper" : "border-chip-border text-ink-80 hover:border-card-strong"
            }`}
          >
            {label}
          </button>
        ))}
        <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-ink-80">
          <input type="checkbox" checked={nycOnly} onChange={(e) => setNycOnly(e.target.checked)} />
          NYC only
        </label>
      </div>

      <p className="mt-4 font-sans text-[12px] text-ink-45">
        {results.length} {results.length === 1 ? "race" : "races"}
        {results.length > shown.length ? ` · showing first ${shown.length}` : ""}
      </p>
      <ul className="mt-2 grid gap-2.5 md:grid-cols-2">
        {shown.map((r) => {
          const hitCandidates = tokens.length
            ? r.c.filter((c) => tokens.some((t) => norm(c.n).includes(t)))
            : [];
          return (
            <li key={r.id} className="rounded-lg border border-card bg-paper-raised p-3.5 hover:border-card-strong">
              <Link href={`/guide/race/${r.id}`} className="block">
                <span className="block font-serif text-[16px] font-bold leading-snug text-ink">{r.t}</span>
                <span className="mt-0.5 line-clamp-1 block font-sans text-[12px] text-ink-45">{r.a}</span>
              </Link>
              <ul className="mt-2 flex flex-col gap-1">
                {r.c.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-1.5 font-sans text-[12.5px] text-ink-80">
                    <Link
                      href={`/guide/race/${r.id}/${c.id}`}
                      className={`hover:underline ${hitCandidates.includes(c) ? "bg-accent-tint font-bold text-ink" : "font-semibold"}`}
                    >
                      {c.n}
                    </Link>
                    {c.p.map((p) => (
                      <span key={p} className="rounded-[3px] border border-chip-border px-1 text-[10px] font-semibold">
                        {p}
                      </span>
                    ))}
                    {c.i && <span className="text-[10px] font-semibold tracking-[0.05em] text-ink-45">INCUMBENT</span>}
                  </li>
                ))}
                {!r.c.length && r.o !== "ballot-measure" && (
                  <li className="font-sans text-[12px] text-ink-45">Candidates not yet verified</li>
                )}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
