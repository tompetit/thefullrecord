import Link from "next/link";
import { LOOKUP_SCOPE } from "@/lib/site";
import { AddressLookupForm } from "@/components/AddressLookupForm";
import { ISSUE_TOPICS } from "@/lib/issues";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">

      <section className="mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 py-12 md:py-16 lg:grid-cols-[1.35fr_1fr] lg:gap-16 lg:px-10 lg:py-20">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent">Public service. Public record.</p>
          <h1 className="mt-5 max-w-2xl font-serif text-[clamp(2.8rem,5.4vw,4.7rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-ink">
            Before you vote,<br />see how they did.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-60 md:text-lg">
            Campaigns tell you what people promise. The record shows what they did.
            Explore the issues you care about, see the votes, and follow the evidence.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/issues" className="inline-flex min-h-12 items-center gap-8 rounded-md bg-accent px-5 py-3 text-sm font-bold text-white hover:bg-accent-deep">Explore the votes by issue <span aria-hidden>↗</span></Link>
            <a href="#find-your-reps" className="inline-flex min-h-12 items-center rounded-md border border-card-strong px-5 py-3 text-sm font-semibold text-ink hover:bg-canvas">Find my representatives <span className="ml-4" aria-hidden>↓</span></a>
          </div>
          <p className="mt-5 text-xs text-ink-60">Nonpartisan. Source-linked. Yours to judge.</p>
        </div>
        <aside className="relative self-center border border-card bg-paper-raised p-6 shadow-card sm:p-8" aria-label="How to read a voting record">
          <div className="flex items-center justify-between border-b border-hairline pb-4 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-60"><span>A closer look</span><span className="text-accent">The evidence matters</span></div>
          <h2 className="mt-5 font-serif text-3xl font-semibold leading-tight text-ink">One vote.<br />More than a headline.</h2>
          <ol className="mt-6 divide-y divide-hairline text-sm">
            {[
              ["01", "What was being decided?", "Read the bill and the specific motion. A procedural vote is different from final passage."],
              ["02", "What did your representative do?", "See the recorded vote, its date, and the outcome in that chamber."],
              ["03", "Where is the evidence?", "Open the official roll call. Check the context and make your own assessment."],
            ].map(([n, title, body]) => <li key={n} className="flex gap-4 py-4"><span className="pt-1 font-mono text-[11px] text-accent">{n}</span><div><h3 className="font-semibold text-ink">{title}</h3><p className="mt-1 text-[13px] leading-relaxed text-ink-60">{body}</p></div></li>)}
          </ol>
          <Link href="/guide/key-votes" className="mt-2 inline-block text-sm font-semibold text-accent hover:underline">Read selected congressional votes <span aria-hidden>→</span></Link>
        </aside>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-14 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-accent">Start with what matters</p><h2 className="mt-2 font-serif text-3xl font-semibold text-ink sm:text-4xl">An issue. An action. A record.</h2></div><Link href="/issues" className="text-sm font-semibold text-accent hover:underline">Browse all issues →</Link></div>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-60">Pick a topic to explore relevant recorded votes. Add your address to see how the representatives we can identify voted.</p>
        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ISSUE_TOPICS.map(({ id, label, description }) => <Link key={id} href={`/issues?topic=${id}`} className="group flex min-h-28 items-center justify-between border border-card bg-paper-raised p-5 transition-colors hover:border-accent hover:bg-accent-tint"><div><h3 className="font-serif text-xl font-semibold text-ink">{label}</h3><p className="mt-1 text-xs text-ink-60">{description}</p></div><span aria-hidden className="ml-3 text-accent transition-transform group-hover:translate-x-1">↗</span></Link>)}
        </div>
      </section>

      <section id="find-your-reps" className="scroll-mt-6 border-y border-hairline bg-canvas/50">
        <div className="mx-auto grid max-w-7xl gap-7 px-4 sm:px-6 py-12 lg:grid-cols-2 lg:gap-16 lg:px-10">
          <div><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-accent">From City Hall to Congress</p><h2 className="mt-3 font-serif text-3xl font-semibold text-ink">Who represents you?</h2><p className="mt-3 max-w-lg text-sm leading-relaxed text-ink-60">{LOOKUP_SCOPE} Explore their votes and the sources behind them.</p></div>
          <div><AddressLookupForm /><Link href="/representatives?sample=1" className="mt-4 inline-block text-xs font-semibold text-accent underline underline-offset-4">Explore a Brooklyn example →</Link></div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-8 px-4 sm:px-6 py-12 md:grid-cols-3 lg:px-10">
        {[["Records before rhetoric", "Recorded votes and official sources are the starting point. Candidate statements are labeled separately."], ["Context before conclusions", "A yes or no belongs to a particular bill or motion. A vote alone does not explain someone’s motives."], ["Gaps in plain sight", "These are selected records, not complete careers. Missing evidence is shown as missing, never inferred from party."]].map(([title, body]) => <div key={title}><h2 className="font-serif text-xl font-semibold text-ink">{title}</h2><p className="mt-2 text-sm leading-relaxed text-ink-60">{body}</p></div>)}
      </section>
    </main>
  );
}
