import Link from "@/components/Link";
import { partyName } from "@/lib/divisive";
import { ISSUE_TOPICS } from "@/lib/issues";
import type { IssueRow } from "@/lib/issueRecord";
import { SourceLink } from "./SourceLink";
import { VoteBadge } from "./VoteBadge";

const label = (id: string) => ISSUE_TOPICS.find((t) => t.id === id)?.label ?? id;

/** "Votes by issue": a member's divided floor votes grouped by topic, with the most contested examples. Counts only — no scores, no stance inferred. */
export function IssueRecordSection({ rows, party, address }: { rows: IssueRow[]; party?: string; address?: string }) {
  const partied = party === "D" || party === "R";
  const q = address ? `&address=${encodeURIComponent(address)}` : "";
  return (
    <section aria-labelledby="by-issue" className="border border-card bg-paper-raised p-4">
      <h2 id="by-issue" className="font-sans text-[12px] font-bold uppercase tracking-[0.06em] text-ink">Votes by issue</h2>
      <p className="mt-1.5 font-sans text-[13px] leading-[1.5] text-ink-60">
        Their recorded votes on bills that divided the chamber (unanimous votes left out), grouped by topic. A bill can sit under more than one topic.
        {partied && ` "With" and "against" compare each vote with how most ${partyName(party!)} voted.`}{" "}
        <Link href="/coverage#topics" className="underline">How topics are assigned</Link>
      </p>
      <ul className="mt-3 flex flex-col border-t border-hairline">
        {rows.map((r) => {
          const scored = r.withParty + r.againstParty;
          const pct = (n: number) => `${(n / Math.max(scored, 1)) * 100}%`;
          return (
            <li key={r.topic} className="border-b border-hairline">
              <details className="group">
                <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] [&::-webkit-details-marker]:hidden">
                  <span className="font-sans text-[14px] font-semibold text-ink">
                    <span aria-hidden className="mr-1.5 inline-block font-mono text-[11px] text-ink-45 transition-transform group-open:rotate-90">›</span>
                    {label(r.topic)}
                  </span>
                  <span className="order-3 col-span-2 flex min-w-0 items-center gap-2 sm:order-none sm:col-span-1">
                    {partied && scored > 0 ? (
                      <>
                        <span className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-[2px] bg-canvas" role="img" aria-label={`${r.withParty} with most ${partyName(party!)}, ${r.againstParty} against`}>
                          <i className="block h-full bg-accent" style={{ width: pct(r.withParty) }} />
                          <i className="block h-full bg-umber" style={{ width: pct(r.againstParty) }} />
                        </span>
                        <span className="flex-none font-mono text-[11px] text-ink-60 tabular-nums">
                          {r.withParty} with · {r.againstParty} against
                        </span>
                      </>
                    ) : (
                      <span className="font-mono text-[11px] text-ink-60 tabular-nums">{r.yes} yes · {r.no} no</span>
                    )}
                  </span>
                  <span className="text-right font-mono text-[12px] font-semibold text-ink tabular-nums">
                    {r.total} <span className="font-normal text-ink-45">{r.total === 1 ? "vote" : "votes"}</span>
                  </span>
                </summary>
                <div className="pb-3 pl-5">
                  <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-45">Most contested</p>
                  <ul className="mt-1 flex flex-col divide-y divide-hairline-soft">
                    {r.examples.map((v) => (
                      <li key={v.id} className="flex items-start gap-3 py-2.5">
                        <VoteBadge vote={v.vote} compact />
                        <div className="min-w-0">
                          <p className="line-clamp-2 font-serif text-[14.5px] font-bold leading-[1.3] text-ink">
                            <Link href={v.href} className="hover:underline">{v.title}</Link>
                          </p>
                          {v.summary && (
                            <p className="mt-0.5 line-clamp-3 font-sans text-[12.5px] leading-[1.5] text-ink-80">{v.summary}</p>
                          )}
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-sans text-xs text-ink-60">
                            <span>
                              {v.dateLabel} · {v.outcome}
                              {partied && v.partySide && ` · ${v.partySide === v.vote ? "with" : "against"} most ${partyName(party!)}`}
                            </span>
                            <span className="inline-flex min-h-11 items-center"><SourceLink href={v.sourceUrl}>Official record</SourceLink></span>
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Link href={`/votes?topic=${r.topic}${q}`} className="inline-flex min-h-11 items-center font-sans text-xs font-semibold text-accent underline">
                    All {label(r.topic).toLowerCase()} votes
                  </Link>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
