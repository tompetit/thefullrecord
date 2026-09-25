import Link from "next/link";
import { REPO_URL } from "@/lib/site";
import type {
  Cited,
  GuideRace,
  GuideSource,
  SourceKind,
  Stance,
} from "@/server/guide/types";
import { Wordmark } from "../Wordmark";

export const KIND_LABEL: Record<SourceKind, string> = {
  official: "Official record",
  candidate: "Candidate's own words",
  news: "News report",
  reference: "Reference",
};

/** Guide-wide top bar. */
export function GuideNav({ active }: { active?: "guide" | "ballot" | "match" | "votes" | "method" }) {
  const links: Array<[typeof active, string, string]> = [
    ["guide", "/guide", "All races"],
    ["ballot", "/guide/ballot", "My ballot"],
    ["match", "/guide/match", "What matters to me"],
    ["votes", "/guide/key-votes", "Key votes"],
    ["method", "/guide/methodology", "How we research"],
  ];
  return (
    <header className="border-b border-hairline">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-[20px] pt-3 pb-2 lg:px-10">
        <Wordmark />
        <nav className="-mx-1 flex max-w-full gap-1 overflow-x-auto pb-1 font-sans text-[13px] text-ink-60">
          {links.map(([key, href, label]) => (
            <Link
              key={href}
              href={href}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 hover:text-ink ${
                active === key ? "bg-ink text-paper hover:text-paper" : ""
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function PartyChips({ parties, size = "sm" }: { parties: string[]; size?: "sm" | "md" }) {
  return (
    <>
      {parties.map((p) => (
        <span
          key={p}
          className={`rounded-[3px] border border-chip-border font-sans font-semibold leading-normal text-ink-80 ${
            size === "md" ? "px-1.5 text-[11.5px]" : "px-1 text-[10.5px]"
          }`}
        >
          {p}
        </span>
      ))}
    </>
  );
}

export function IncumbentTag() {
  return (
    <span className="font-sans text-[10.5px] font-semibold tracking-[0.05em] text-ink-45">
      INCUMBENT
    </span>
  );
}

/** Initials in a neutral disc — every candidate treated identically. */
export function Monogram({ name, size = 44 }: { name: string; size?: number }) {
  const initials = name
    .replace(/\(.*?\)|["“”]/g, "")
    .split(/\s+/)
    .filter((w) => /^[A-Za-zÀ-ž]/.test(w) && !/^(jr|sr|ii|iii|iv)\.?$/i.test(w))
    .map((w) => w[0])
    .filter(Boolean);
  const text = (initials[0] ?? "") + (initials.length > 1 ? initials[initials.length - 1] : "");
  return (
    <span
      aria-hidden
      className="hatch flex flex-none items-center justify-center rounded-full font-serif font-bold text-ink-60"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {text.toUpperCase()}
    </span>
  );
}

const STANCE: Record<Stance, { word: string; cls: string; mark: string }> = {
  supports: { word: "Supports", cls: "bg-accent-tint border-accent text-accent-deep", mark: "✓" },
  opposes: { word: "Opposes", cls: "bg-umber-tint border-umber text-umber-deep", mark: "✕" },
  mixed: { word: "Mixed", cls: "bg-neutral-chip border-neutral-chip-border text-ink-80", mark: "~" },
};

export function StanceChip({ stance }: { stance: Stance }) {
  const s = STANCE[stance];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border-[1.5px] px-1.5 py-0.5 font-sans text-[11.5px] font-bold ${s.cls}`}
    >
      <span aria-hidden>{s.mark}</span>
      {s.word}
    </span>
  );
}

/** Superscript citation links: [1][2] → the source, opening in a new tab. */
export function Cites({
  ids,
  race,
}: {
  ids: string[];
  race: Pick<GuideRace, "sources">;
}) {
  const numbered = ids
    .map((id) => {
      const idx = race.sources.findIndex((s) => s.id === id);
      return idx >= 0 ? { n: idx + 1, s: race.sources[idx] } : null;
    })
    .filter(Boolean) as Array<{ n: number; s: GuideSource }>;
  if (!numbered.length) return null;
  return (
    <span className="whitespace-nowrap">
      {numbered.map(({ n, s }) => (
        <a
          key={s.id}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`${KIND_LABEL[s.kind]} · ${s.publisher}: ${s.title}`}
          className={`ml-0.5 align-super font-sans text-[9.5px] font-bold no-underline hover:underline ${
            s.kind === "official" ? "text-accent" : "text-ink-45"
          }`}
        >
          [{n}]
        </a>
      ))}
    </span>
  );
}

export function CitedText({ c, race, className = "" }: { c: Cited; race: GuideRace; className?: string }) {
  return (
    <span className={className}>
      {c.text}
      <Cites ids={c.sources} race={race} />
    </span>
  );
}

export function SourceList({ race, ids }: { race: GuideRace; ids?: Set<string> }) {
  const list = race.sources
    .map((s, i) => ({ s, n: i + 1 }))
    .filter(({ s }) => !ids || ids.has(s.id));
  if (!list.length) return null;
  return (
    <ol className="flex flex-col gap-1.5">
      {list.map(({ s, n }) => (
        <li key={s.id} className="flex gap-2 font-sans text-[12px] leading-snug text-ink-60">
          <span className="w-7 flex-none text-right font-mono text-[11px] text-ink-45">{n}.</span>
          <span className="min-w-0">
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-words text-ink-80 underline decoration-hairline underline-offset-2 hover:decoration-ink"
            >
              {s.title}
            </a>{" "}
            <span className="text-ink-45">
              · {s.publisher}
              {s.date ? ` · ${s.date}` : ""}
            </span>{" "}
            <KindBadge kind={s.kind} />
          </span>
        </li>
      ))}
    </ol>
  );
}

export function KindBadge({ kind }: { kind: SourceKind }) {
  const cls =
    kind === "official"
      ? "border-accent-tint-border bg-accent-tint text-accent-deep"
      : "border-neutral-chip-border bg-neutral-chip text-ink-60";
  return (
    <span className={`whitespace-nowrap rounded-[3px] border px-1 text-[10px] font-semibold ${cls}`}>
      {KIND_LABEL[kind]}
    </span>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-sans text-[11px] font-bold tracking-[0.08em] text-ink-45 uppercase">
      {children}
    </h2>
  );
}

export function money(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export const OFFICE_LABEL: Record<string, string> = {
  "us-senate": "U.S. Senate",
  "us-house": "U.S. House",
  governor: "Governor",
  "attorney-general": "Attorney General",
  comptroller: "Comptroller",
  "state-senate": "State Senate",
  "state-assembly": "State Assembly",
  "ballot-measure": "Ballot measure",
  other: "Other",
};

export function GuideFooter() {
  return (
    <footer className="mt-16 border-t border-hairline">
      <div className="mx-auto max-w-6xl px-[20px] py-6 font-sans text-xs leading-[1.6] text-ink-45 lg:px-10">
        The Full Record is non-partisan: no endorsements, no scores, no grades.
        Every claim links to its source — official records first.{" "}
        <Link href="/guide/methodology" className="underline hover:text-ink">
          How we research
        </Link>{" "}
        ·{" "}
        <Link href="/" className="underline hover:text-ink">
          Your current representatives
        </Link>{" "}
        ·{" "}
        <a href={REPO_URL} className="underline hover:text-ink">
          Open source on GitHub
        </a>
      </div>
    </footer>
  );
}
