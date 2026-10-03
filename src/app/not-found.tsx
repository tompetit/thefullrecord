import Link from "next/link";

export default function NotFound() {
  return <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-12 sm:px-6 lg:px-10 [&>*]:max-w-3xl"><p className="text-xs font-bold uppercase tracking-widest text-ink-60">Page not found</p><h1 className="mt-3 font-serif text-3xl font-semibold text-ink">This record isn&rsquo;t here.</h1><p className="mt-4 text-sm leading-relaxed text-ink-60">The link may be out of date, or this record may not be in our collection. You can still browse the votes and researched races we have.</p><div className="mt-6 flex flex-wrap gap-5 text-sm font-semibold text-accent"><Link href="/issues" className="min-h-11 py-3 underline">Explore the votes →</Link><Link href="/guide" className="min-h-11 py-3 underline">Browse the voter guide →</Link></div></main>;
}
