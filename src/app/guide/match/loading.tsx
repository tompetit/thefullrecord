import { GuideNav } from "@/components/guide/ui";

export default function LoadingComparison() {
  return <main className="flex-1" aria-busy="true"><GuideNav active="match" /><div className="mx-auto max-w-6xl px-6 py-10"><h1 className="font-serif text-3xl font-semibold text-ink">Finding the evidence</h1><p role="status" className="mt-4 text-sm text-ink-60">Checking researched races and their documented records. Address lookups can take a few moments.</p></div></main>;
}
