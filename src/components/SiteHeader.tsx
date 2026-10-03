"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "./Wordmark";
import { useAddress } from "./useAddress";

type Section = "reps" | "votes" | "guide" | "data";

/** Which primary section a path belongs to (null: home, digest, 404…). */
export function sectionFor(pathname: string): Section | null {
  const top = pathname.split("/")[1] ?? "";
  if (top === "representatives" || top === "official" || top === "bill") return "reps";
  if (top === "issues") return "votes";
  if (top === "guide") return "guide";
  if (top === "coverage") return "data";
  return null;
}

/**
 * The one site header, rendered by the root layout on every page: wordmark,
 * the primary sections in a fixed order, and — when an address is saved for
 * this tab — a secondary address line that never moves the primary links.
 * Page-specific breadcrumbs and back links belong below it, inside the page.
 */
export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const { address, clearAddress } = useAddress();
  const active = sectionFor(pathname);
  const repsHref = address ? `/representatives?address=${encodeURIComponent(address)}` : "/representatives";
  const items: Array<[Section, string, string]> = [
    ["reps", repsHref, "My representatives"],
    ["votes", "/issues", "Explore the votes"],
    ["guide", "/guide", "Voter guide"],
    ["data", "/coverage", "Our data"],
  ];

  const links = (mobile: boolean) =>
    items.map(([key, href, label]) => {
      const current = key === active;
      return (
        <li key={key}>
          <Link
            href={href}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-11 items-center whitespace-nowrap font-sans font-semibold ${
              mobile ? "px-5 text-[15px]" : "text-[13.5px]"
            } ${
              current
                ? "text-accent underline decoration-2 underline-offset-[7px]"
                : "text-ink-60 hover:text-ink hover:underline hover:decoration-hairline hover:decoration-2 hover:underline-offset-[7px]"
            }`}
          >
            {label}
          </Link>
        </li>
      );
    });

  return (
    <header className="relative border-b border-hairline bg-paper print:hidden">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-8 px-4 py-1.5 sm:px-6 lg:px-10">
        <Wordmark className="text-[21px]" />

        {/* ≥768px: the sections inline. */}
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex flex-wrap items-center gap-x-6">{links(false)}</ul>
        </nav>

        {/* <768px: a disclosure menu (works without JavaScript; re-mounts
            closed after each navigation). */}
        <details key={pathname} className="group ml-auto md:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-3 font-sans text-[14px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="flex w-4 flex-col gap-[3px]">
              <span className="h-[2px] bg-current" />
              <span className="h-[2px] bg-current" />
              <span className="h-[2px] bg-current" />
            </span>
            Menu
          </summary>
          <nav
            aria-label="Main"
            className="absolute inset-x-0 z-50 mt-1.5 border-y border-hairline bg-paper-raised py-2 shadow-[0_8px_24px_rgba(33,30,25,0.12)]"
          >
            <ul>{links(true)}</ul>
          </nav>
        </details>

        {address && (
          <div className="flex w-full min-w-0 items-center gap-x-3 border-t border-hairline-soft font-sans text-xs text-ink-60 lg:ml-auto lg:w-auto lg:border-t-0">
            <span className="shrink-0">Your address:</span>
            <span className="min-w-0 truncate text-ink-80" title={address}>
              {address}
            </span>
            <Link href="/#find-your-reps" className="inline-flex min-h-11 shrink-0 items-center underline hover:text-ink">
              Change
            </Link>
            <button
              type="button"
              onClick={clearAddress}
              className="min-h-11 shrink-0 cursor-pointer underline hover:text-ink"
            >
              Clear<span className="sr-only"> saved address</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
