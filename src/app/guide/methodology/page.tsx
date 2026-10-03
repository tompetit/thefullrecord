import { SectionLabel } from "@/components/guide/ui";
import { getGuideStats } from "@/server/guide/load";

export const metadata = { title: "How we research — The Full Record" };

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 font-sans text-[14.5px] leading-[1.7] text-ink-80">{children}</p>;
}

export default function MethodologyPage() {
  const s = getGuideStats();
  return (
    <main className="flex-1">
      <article className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10 pt-8 [&>*]:max-w-3xl">
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
            country.
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
            The guide groups evidence under 15 issue subjects. Candidate statements
            are shown with citations. Recorded votes are shown as votes on specific
            bills, with their dates and official sources. We do not treat a vote on
            a bill as proof of a broad policy belief, or assume a no vote means the
            opposite of every provision in a bill. This is especially important for
            legislation that combines many policies. Statements and actions can be
            read alongside one another without assigning a consistency verdict.
            Missing evidence means we have not documented it; it does not establish
            a candidate&rsquo;s position.
          </P>
          <P>
            &ldquo;Compare by issue&rdquo; filters documented evidence by subject.
            Candidates appear alphabetically within each race, with the same topics
            displayed for everyone. Vote-based evidence is labeled separately from
            other documented positions. We do not weight issues or calculate
            candidate scores. Missing research is shown as a gap.
          </P>
        </section>

        <section className="mt-8 scroll-mt-4" id="where-i-stand">
          <SectionLabel>&ldquo;Where I stand&rdquo; — how the comparison works</SectionLabel>
          <P>
            On &ldquo;Compare by issue&rdquo; you can optionally answer Agree or Disagree to
            any of the issue statements (for example, &ldquo;Stronger rent regulation and
            tenant protections&rdquo;). Anything you leave as &ldquo;Not sure / skip&rdquo; is
            left out. For each statement you answered, every candidate&rsquo;s documented
            position on that same statement is put next to your answer. What a candidate
            <i>says</i> and how they <i>voted</i> are compared separately:
          </P>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 font-sans text-[14.5px] leading-[1.65] text-ink-80">
            <li><b>= Same as you</b> — you agree and their documented position supports the statement, or you disagree and it opposes it.</li>
            <li><b>≠ Different from you</b> — the documented position points the other way from your answer.</li>
            <li><b>~ Mixed record</b> — the documented position is mixed (for example, support for part of a policy). It is not counted as same or different.</li>
            <li><b>Recorded votes, one at a time</b> — for officeholders, each key floor vote on the topic is listed with its official roll call. For every vote we note which way a Yes points relative to the statement — only when the bill&rsquo;s central effect squarely matches it (for example, a Yes on the Bipartisan Background Checks Act is in line with &ldquo;Stricter gun laws&rdquo;; a Yes on concealed-carry reciprocity is not). Each vote is then marked <b>= In line with your answer</b> or <b>≠ Not in line with your answer</b>. A No vote is read only as a vote against that measure — never as support for some opposite policy — and we never turn a set of votes into an overall stance. Votes where we haven&rsquo;t recorded a direction are shown but not compared. The direction notes are in the site&rsquo;s open-source code, with the provision each one rests on.</li>
            <li><b>– No documented position</b> — our research found nothing on the topic. That is a gap in our research, not a position.</li>
          </ul>
          <P>
            Each comparison shows the summary, the votes and their citations. Under each
            candidate we give plain tallies that keep statements and votes apart — for
            example, &ldquo;Statements: same as you on 3, different on 1 · Recorded votes:
            4 votes in line with your answers, 1 not · No record on 2 of the 7 topics you
            answered&rdquo;. There is no
            percentage, score, meter, weighting, or &ldquo;best match&rdquo;. Every answered
            topic counts the same, candidates stay in alphabetical order, and the
            comparison is not a recommendation.
          </P>
          <P>
            <b>Limits.</b> Research coverage varies a lot between candidates — incumbents
            and well-funded campaigns leave more public record, so a candidate with
            fewer documented positions will show more &ldquo;No record&rdquo; results.
            Missing evidence is not a position. Statements are not actions, and recorded
            votes are not broad policy positions. A single statement can&rsquo;t capture
            every nuance, and candidates may have changed their positions since the
            sources were published, so check the dates on the citations. The issue
            statements are fixed wording and may not match exactly how you would put it.
          </P>
          <P>
            <b>Privacy.</b> Your answers aren&rsquo;t stored by us or tied to you. They live
            in the page&rsquo;s link (as <code className="font-mono text-[13px]">?stand=…</code>,
            so you can bookmark or share it) and, for convenience, in your browser tab
            until you close it. Like any web address, the link may appear in routine
            web-server request logs, and anyone you share it with will see your answers
            and any address it contains.
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
            check with your state or county board of elections for the final word on what&rsquo;s on your ballot.
          </P>
        </section>
      </article>
    </main>
  );
}
