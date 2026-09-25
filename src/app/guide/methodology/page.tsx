import { GuideFooter, GuideNav, SectionLabel } from "@/components/guide/ui";
import { getGuideStats } from "@/server/guide/load";

export const metadata = { title: "How we research — The Full Record" };

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 font-sans text-[14.5px] leading-[1.7] text-ink-80">{children}</p>;
}

export default function MethodologyPage() {
  const s = getGuideStats();
  return (
    <main className="flex-1">
      <GuideNav active="method" />
      <article className="mx-auto w-full max-w-3xl px-[20px] pt-8 lg:px-10">
        <h1 className="font-serif text-[30px] font-semibold tracking-[-0.015em] text-ink lg:text-[42px]">How we research</h1>
        <P>
          The goal of this guide is to inform, not to persuade. It covers{" "}
          {s.races.toLocaleString()} races and {s.candidates.toLocaleString()} candidates on the
          November 3, 2026 ballot, with {s.sources.toLocaleString()} cited sources — {" "}
          {s.officialSources.toLocaleString()} of them official government records.
        </P>

        <section className="mt-8">
          <SectionLabel>Coverage</SectionLabel>
          <P>
            <b>New York City, in depth:</b> Governor, Attorney General, Comptroller,
            every U.S. House district that touches the city, every NYC State Senate
            and Assembly district, and the city&rsquo;s ballot proposals.{" "}
            <b>Everywhere else:</b> every U.S. House and U.S. Senate race in the
            country, plus New Jersey&rsquo;s federal races in depth.
          </P>
        </section>

        <section className="mt-8">
          <SectionLabel>Sources, in order of preference</SectionLabel>
          <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 font-sans text-[14.5px] leading-[1.65] text-ink-80">
            <li><b>Official records</b> — roll-call votes from the House Clerk, the U.S. Senate, the NY Senate and Assembly; bill texts and histories; FEC filings; court and government records. Shown with a green citation.</li>
            <li><b>The candidate&rsquo;s own words</b> — campaign sites, press releases, questionnaires, and verbatim interviews or debates.</li>
            <li><b>Independent news reporting</b> from established outlets.</li>
            <li><b>Reference works</b> like Ballotpedia — used for basic facts such as ballot status and party lines, not for positions.</li>
          </ol>
          <P>We don&rsquo;t use anonymous claims, opinion columns, or partisan attack material.</P>
        </section>

        <section className="mt-8">
          <SectionLabel>Every claim is cited</SectionLabel>
          <P>
            Each sentence about a candidate carries numbered citations that open the
            source. If a claim can&rsquo;t be sourced, it isn&rsquo;t published. Each race
            page lists every source it uses and notes what we couldn&rsquo;t find.
          </P>
        </section>

        <section className="mt-8">
          <SectionLabel>Issue positions</SectionLabel>
          <P>
            We compare candidates on 15 fixed issue statements (for example
            &ldquo;Stricter gun laws&rdquo;). A position is recorded only when a source
            shows it directly: the candidate&rsquo;s own statement, a vote, a bill they
            sponsored, or a questionnaire answer. We never infer a position from
            party. <b>Votes outrank words.</b> For sitting members of Congress, where
            recorded floor votes bear directly on an issue — the Laken Riley Act
            (immigration enforcement), tariff disapproval resolutions (tariffs), the
            ACA subsidy extension (public coverage), and the One Big Beautiful Bill
            Act (its Medicaid reductions, immigration-enforcement funding,
            clean-energy credit repeal, and permanent 2017 tax rates) — the votes set
            the position, each linked to the official roll call. What the member
            says on the same issue is shown beneath it, flagged when it differs
            from how they voted. For New York Assembly members, recorded votes on
            landmark laws set positions the same way — the 2019 rent law (HSTPA), the
            climate law (CLCPA), the red-flag and concealed-carry gun laws, the
            Reproductive Health Act, the Protect Our Courts Act, and the 2021 tax
            increase on high earners — read from the Assembly&rsquo;s official floor-vote
            records. Challengers who held other office are shown with their votes
            from those offices where official records were reachable. A dash means no clear
            public position was found — not that the
            candidate has none.
          </P>
          <P>
            &ldquo;What matters to me&rdquo; compares your answers only with those
            documented positions, counting vote-based positions 1.5&times; as much as
            campaign statements. It is not a recommendation, and a
            candidate&rsquo;s silence on an issue counts neither for nor against them.
          </P>
        </section>

        <section className="mt-8">
          <SectionLabel>Congressional votes & money</SectionLabel>
          <P>
            Key votes are read by script straight from the official House Clerk and
            U.S. Senate roll-call XML, and matched to members through the public{" "}
            <a className="underline" href="https://github.com/unitedstates/congress-legislators">congress-legislators</a>{" "}
            crosswalk. Campaign-finance totals come from the Federal Election
            Commission&rsquo;s bulk candidate summary for the 2026 cycle.
          </P>
        </section>

        <section className="mt-8">
          <SectionLabel>Who does the research</SectionLabel>
          <P>
            Profiles are researched and written by AI research agents working to a
            written standard (neutral language, primary sources first, verbatim
            quotes only, never fabricate) and checked by automated validation of
            every citation. AI makes mistakes. Always follow the citation, and
            use &ldquo;Report an issue&rdquo; — or your state or county board of
            elections — for the final word on what&rsquo;s on your ballot.
          </P>
        </section>
      </article>
      <GuideFooter />
    </main>
  );
}
