import Link from "next/link";
import { REPO_URL } from "@/lib/site";

/** The one site footer, rendered by the root layout on every page. */
export function SiteFooter() {
  const link = "inline-flex min-h-11 items-center underline hover:text-ink";
  return (
    <footer className="mt-12 border-t border-hairline print:hidden">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3 font-sans text-xs text-ink-60 sm:px-6 lg:px-10">
        <p>Independent civic research. No endorsements, scores, or grades.</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5">
          <Link href="/guide/methodology" className={link}>How we research</Link>
          <Link href="/coverage" className={link}>Our data</Link>
          <a href={`${REPO_URL}/issues`} className={link}>Suggest a correction</a>
          <a href={REPO_URL} className={link}>Open source</a>
        </nav>
      </div>
    </footer>
  );
}
