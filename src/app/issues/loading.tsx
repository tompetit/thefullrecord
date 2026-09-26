import { Wordmark } from "@/components/Wordmark";

export default function LoadingIssues() {
  return <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-5" aria-busy="true"><Wordmark /><h1 className="mt-12 font-serif text-3xl font-semibold text-ink">Opening the record</h1><p role="status" className="mt-4 max-w-xl text-sm leading-relaxed text-ink-60">Loading recorded votes and, if you entered an address, checking its districts and representatives.</p></main>;
}
