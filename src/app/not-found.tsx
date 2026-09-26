import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export default function NotFound() {
  return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-6"><Wordmark /><p className="mt-12 text-xs font-bold uppercase tracking-widest text-ink-60">Page not found</p><h1 className="mt-3 font-serif text-3xl font-semibold text-ink">This record isn&rsquo;t here.</h1><p className="mt-4 text-sm leading-relaxed text-ink-60">The link may be out of date, or this record may not be in our collection. You can still browse the votes and researched races we have.</p><div className="mt-6 flex flex-wrap gap-5 text-sm font-semibold text-accent"><Link href="/issues" className="min-h-11 py-3 underline">Explore votes →</Link><Link href="/guide" className="min-h-11 py-3 underline">Browse the voter guide →</Link></div></main>;
}
