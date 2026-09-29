import { AppHeader } from "@/components/AppHeader";

export default function LoadingRepresentatives() {
  return <main className="mx-auto w-full max-w-5xl flex-1 pb-12" aria-busy="true"><AppHeader /><div className="px-6 py-10 lg:px-10"><h1 className="font-serif text-3xl font-semibold text-ink">Finding your representatives</h1><p role="status" className="mt-4 font-sans text-sm leading-relaxed text-ink-60">Checking the address, legislative districts, and public rosters. This can take a few moments.</p></div></main>;
}
