import Link from "next/link";
import { GuideFooter, GuideNav, SectionLabel } from "@/components/guide/ui";
import { getAllRaces, getKeyVoteDefs } from "@/server/guide/load";

export const metadata = {
  title: "Key votes in Congress, 2025–26 — The Full Record",
  description:
    "The most consequential House and Senate floor votes of the 119th Congress, and how every member running in 2026 voted — straight from the official roll calls.",
};

const VOTE_GROUPS = [
  ["yes", "Voted yes"],
  ["no", "Voted no"],
  ["present", "Present"],
  ["not voting", "Did not vote"],
] as const;

export default function KeyVotesPage() {
  const defs = getKeyVoteDefs();
  const races = getAllRaces();
  // voteId -> vote -> [{name, raceId, candidateId, state, parties}]
  const byVote = new Map<string, Map<string, Array<{ name: string; raceId: string; cid: string; label: string }>>>();
  for (const r of races)
    for (const c of r.candidates)
      for (const kv of c.keyVotes ?? []) {
        const m = byVote.get(kv.voteId) ?? new Map();
        const list = m.get(kv.vote) ?? [];
        list.push({ name: c.name, raceId: r.id, cid: c.id, label: `${c.parties[0] ?? ""}-${r.state}` });
        m.set(kv.vote, list);
        byVote.set(kv.voteId, m);
      }

  return (
    <main className="flex-1">
      <GuideNav active="votes" />
      <div className="mx-auto w-full max-w-5xl px-[20px] pt-8 lg:px-10">
        <h1 className="font-serif text-[30px] font-semibold tracking-[-0.015em] text-ink lg:text-[42px]">
          Key votes in Congress, 2025–26
        </h1>
        <p className="mt-2 max-w-2xl font-sans text-[14.5px] leading-[1.6] text-ink-60">
          {defs.length} of the most consequential floor votes of the 119th
          Congress, chosen across topics. Every position is read directly from
          the official roll call published by the House Clerk or the Senate.
          Under each vote: how every member of Congress on a 2026 ballot in this
          guide voted.
        </p>
        {(["house", "senate"] as const).map((chamber) => (
          <section key={chamber} className="mt-10">
            <SectionLabel>{chamber === "house" ? "U.S. House" : "U.S. Senate"}</SectionLabel>
            <ol className="mt-3 flex flex-col gap-3">
              {defs
                .filter((d) => d.chamber === chamber)
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((d) => {
                  const groups = byVote.get(d.id);
                  const n = groups ? [...groups.values()].reduce((s, l) => s + l.length, 0) : 0;
                  return (
                    <li key={d.id} id={d.id} className="rounded-xl border border-card bg-paper-raised p-4">
                      <div className="font-sans text-[11px] font-bold tracking-[0.06em] text-ink-45">
                        {d.bill} · {d.date} · {d.topic.toUpperCase()}
                      </div>
                      <h2 className="mt-1 font-serif text-[18px] font-bold leading-snug text-ink">{d.shortTitle}</h2>
                      <p className="mt-1.5 font-sans text-[13.5px] leading-[1.55] text-ink-80">{d.summary}</p>
                      <p className="mt-2 font-sans text-[12.5px] text-ink-60">
                        <b className="text-ink-80">{d.result} {d.yea}–{d.nay}</b> · {d.question} ·{" "}
                        <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent">
                          Official roll call ↗
                        </a>
                        {d.summarySourceUrl && (
                          <>
                            {" · "}
                            <a href={d.summarySourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent">
                              Bill summary ↗
                            </a>
                          </>
                        )}
                      </p>
                      {groups && (
                        <details className="mt-2">
                          <summary className="cursor-pointer font-sans text-[12.5px] font-semibold text-ink-80">
                            How {n} candidates on 2026 ballots voted
                          </summary>
                          <div className="mt-2 grid gap-3 sm:grid-cols-2">
                            {VOTE_GROUPS.filter(([k]) => groups.get(k)?.length).map(([k, label]) => (
                              <div key={k}>
                                <h3 className="font-sans text-[11px] font-bold tracking-[0.05em] text-ink-45 uppercase">
                                  {label} · {groups.get(k)!.length}
                                </h3>
                                <p className="mt-1 font-sans text-[12.5px] leading-[1.7] text-ink-80">
                                  {groups
                                    .get(k)!
                                    .sort((a, b) => a.name.localeCompare(b.name))
                                    .map((m, i) => (
                                      <span key={m.raceId + m.cid}>
                                        {i > 0 && ", "}
                                        <Link href={`/guide/race/${m.raceId}/${m.cid}`} className="hover:underline">
                                          {m.name}
                                        </Link>{" "}
                                        <span className="text-ink-45">({m.label})</span>
                                      </span>
                                    ))}
                                </p>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </li>
                  );
                })}
            </ol>
          </section>
        ))}
      </div>
      <GuideFooter />
    </main>
  );
}
