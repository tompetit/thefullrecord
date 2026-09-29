"use client";

import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export default function ErrorPage({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-6"><Wordmark /><h1 className="mt-12 font-serif text-3xl font-semibold text-ink">We couldn&rsquo;t open this record.</h1><p className="mt-4 text-sm leading-relaxed text-ink-60">The page encountered a problem. Try loading it again, or return to the issue explorer to continue browsing.</p><div className="mt-6 flex flex-wrap gap-4"><button type="button" onClick={unstable_retry} className="min-h-11 cursor-pointer rounded-md bg-accent px-5 py-3 text-sm font-semibold text-white">Try again</button><Link href="/issues" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">Explore recorded votes</Link></div></main>;
}
