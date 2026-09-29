"use client";

import { useRef, useState } from "react";
import type {
  AttendanceEntry,
  Official,
  Paginated,
  SaidDidPair,
  Sponsorship,
  VoteKind,
  VoteRecord,
} from "@/server/types";
import { FilterChips } from "./FilterChips";
import { SaidVsDid } from "./SaidVsDid";
import { SourceLink } from "./SourceLink";
import { VoteCard } from "./VoteCard";
import { AiMarker } from "./AiMarker";

type Tab = "votes" | "sponsorships" | "attendance" | "said-vs-did";
type VoteFilter = "all" | VoteKind;

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "votes", label: "Votes" },
  { id: "sponsorships", label: "Sponsorships" },
  { id: "attendance", label: "Participation" },
  { id: "said-vs-did", label: "Said vs. did" },
];

/**
 * Official-profile tab bar + feed. Tabs switch the feed in place;
 * the Votes tab filters via chips and refetches from the API.
 */
export function ProfileTabs({
  official,
  initialVotes,
  sponsorships,
  attendance,
  saidDidPairs,
}: {
  official: Official;
  initialVotes: Paginated<VoteRecord>;
  sponsorships: Paginated<Sponsorship>;
  attendance: Paginated<AttendanceEntry>;
  saidDidPairs: Paginated<SaidDidPair>;
}) {
  const [tab, setTab] = useState<Tab>("votes");
  const [voteFilter, setVoteFilter] = useState<VoteFilter>("all");
  const [votes, setVotes] = useState(initialVotes);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");
  const request = useRef(0);

  async function loadVotes(filter: VoteFilter, append = false) {
    const requestId = ++request.current;
    setLoading(true);
    setError("");
    try {
      const page = append ? votes.page + 1 : 1;
      const res = await fetch(`/api/officials/${encodeURIComponent(official.id)}/votes?filter=${filter}&page=${page}`);
      if (!res.ok) throw new Error("Request failed");
      const next = await res.json() as Paginated<VoteRecord>;
      if (!Array.isArray(next.items)) throw new Error("Invalid response");
      if (requestId !== request.current) return;
      setVoteFilter(filter);
      setVotes(previous => append ? { ...next, items: [...previous.items, ...next.items] } : next);
    } catch {
      if (requestId === request.current) setError("We couldn’t load those votes. Your current results are still shown. Try again.");
    } finally {
      if (requestId === request.current) setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Record sections" className="flex flex-wrap items-end gap-x-[18px] border-b border-hairline font-sans text-[13px]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`min-h-11 cursor-pointer pb-[9px] ${
              tab === t.id
                ? "-mb-px border-b-2 border-ink font-bold text-ink"
                : "text-ink-45 hover:text-ink-60"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "votes" && (
        <div className="flex flex-col gap-3">
          <FilterChips
            value={voteFilter}
            onChange={(filter) => loadVotes(filter)}
            options={[
              { value: "all", label: "All" },
              { value: "substantive", label: "Substantive" },
              { value: "procedural", label: "Procedural" },
            ]}
          />
          <p className="font-sans text-xs leading-relaxed text-ink-60">
            Substantive votes concern legislation or nominations; procedural votes concern how the chamber considers them. A Yes vote applies to the motion shown, which may not be final passage.
          </p>
          <p role="status" aria-live="polite" className="font-sans text-xs text-ink-60">{loading ? "Loading votes…" : error}</p>
          {votes.items.length === 0 ? (
            <p className="rounded-lg border border-hairline-soft bg-paper-raised p-4 font-sans text-[13px] leading-relaxed text-ink-60">
              {voteFilter === "all"
                ? "No vote records are available here for this official yet. This is a coverage gap, not evidence that the official did not vote."
                : `No ${voteFilter} votes are available in this collection. Try All to see other records.`}
              {" "}<SourceLink href={official.contactUrl}>Official website</SourceLink>
            </p>
          ) : (
            <>
              <div
                className={`flex flex-col gap-3 ${loading ? "opacity-60" : ""}`}
              >
                {votes.items.map((v) => (
                  <VoteCard key={v.id} vote={v} />
                ))}
              </div>
              <p className="font-sans text-xs text-ink-60">
                Showing {votes.items.length} of {votes.total} {voteFilter === "all" ? "" : voteFilter + " "}votes in this collection. Coverage may be incomplete; each entry links to the official record.
              </p>
              {votes.items.length < votes.total && (
                <button type="button" disabled={loading} onClick={() => loadVotes(voteFilter, true)} className="min-h-11 rounded-lg border border-chip-border px-4 py-3 font-sans text-sm font-semibold disabled:opacity-50">
                  {loading ? "Loading…" : "Load more votes"}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {tab === "sponsorships" &&
        (sponsorships.items.length === 0 ? (
          <p className="rounded-lg border border-hairline-soft bg-paper-raised p-4 font-sans text-[13px] leading-relaxed text-ink-60">
            No sponsored bills are on file for this official yet. Their full
            sponsorship record is available from the official chamber records
            linked on each vote.
          </p>
        ) : (
        <div className="flex flex-col gap-3">
          {sponsorships.items.map((s) => (
            <article
              key={s.id}
              className="flex flex-col rounded-lg border border-card bg-paper-raised p-4 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-[3px]">
                  <div className="font-sans text-[11px] font-bold tracking-[0.06em] text-ink-45">
                    {s.billNumber} · {s.chamber}
                  </div>
                  <h3 className="font-serif text-[16.5px] font-bold leading-[1.3] text-ink text-pretty">
                    {s.title}
                  </h3>
                </div>
                <span className="flex-none rounded-full border border-chip-border px-2.5 py-1 font-sans text-[11px] font-semibold text-ink-80">
                  {s.sponsorRole}
                </span>
              </div>
              {s.aiSummary && (
                <>
                  <p className="mt-2.5 font-sans text-[13.5px] leading-[1.55] text-ink-80 text-pretty">
                    {s.aiSummary}
                  </p>
                  <AiMarker
                    billTextUrl={s.sourceUrl}
                  />
                </>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline-soft py-[11px] font-sans text-xs text-ink-60">
                <span className="font-semibold text-ink-80">{s.status}</span>
                <span className="text-[#c9c0ac]">·</span>
                <span>{s.dateLabel}</span>
                <span className="ml-auto">
                  <SourceLink href={s.sourceUrl}>Bill record</SourceLink>
                </span>
              </div>
            </article>
          ))}
          <p className="font-sans text-xs text-ink-60">
            Showing {sponsorships.items.length} of {sponsorships.total}{" "}
            sponsored bills on file.
          </p>
        </div>
        ))}

      {tab === "attendance" &&
        (attendance.items.length === 0 ? (
          <p className="rounded-lg border border-hairline-soft bg-paper-raised p-4 font-sans text-[13px] leading-relaxed text-ink-60">
            Source roll callss for this official are not yet available here.
            Roll-call attendance is published by the chamber; each vote in the
            Votes tab links to its official roll call.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="font-sans text-xs leading-relaxed text-ink-60">Participation reflects recorded votes in our collection, not physical attendance. A recorded non-vote does not tell us why the member did not vote. Coverage may be incomplete.</p>
            <section className="rounded-lg border border-card bg-paper-raised p-4 shadow-card">
              <ul className="flex flex-col divide-y divide-hairline-soft">
                {attendance.items.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 py-3 font-sans text-[13px] text-ink-80"
                  >
                    <span>{a.period}</span>
                    <span className="flex items-center gap-3">
                      <span className="font-semibold text-ink">
                        {a.attended} of {a.total} recorded votes
                      </span>
                      <SourceLink href={a.sourceUrl} className="text-xs">
                        Source roll calls
                      </SourceLink>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            {official.stats.rollCallsAttendedPct !== null && (
              <p className="font-sans text-xs text-ink-60">
                Recorded participation in {official.stats.rollCallsAttendedPct}% of the roll calls in this collection. This is not a measure of physical attendance or the official’s complete activity.
              </p>
            )}
          </div>
        ))}

      {tab === "said-vs-did" && (
        <SaidVsDid pairs={saidDidPairs.items} total={saidDidPairs.total} />
      )}
    </div>
  );
}
