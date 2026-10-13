import Link from "@/components/Link";
import { ISSUE_TOPICS, SPLIT_LABELS, chamberLabel, repsSplit, type IssueRecord } from "@/lib/issues";

const chip = "rounded border border-chip-border bg-neutral-chip px-2 py-1";

function partyBreakdown(parties: IssueRecord["parties"]) {
  return [parties?.D && `Democrats ${parties.D[0]}–${parties.D[1]}`, parties?.R && `Republicans ${parties.R[0]}–${parties.R[1]}`].filter(Boolean).join(" · ");
}

export function IssueCards({ records, address = "" }: { records: IssueRecord[]; address?: string }) {
  return records.map((record) => {
    const split = SPLIT_LABELS[record.splitKind];
    const breakdown = partyBreakdown(record.parties);
    return <article key={record.id} className="overflow-hidden rounded-xl border border-card bg-paper-raised">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-semibold tracking-wide text-ink-60"><span>{chamberLabel(record.chamber)}</span><span aria-hidden="true">/</span><span>{record.bill || "Vote"}</span><time className="sm:ml-auto" dateTime={record.date}>{record.dateLabel}</time></div>
        <h3 className="mt-3 line-clamp-3 font-serif text-xl font-semibold leading-snug text-ink sm:line-clamp-none"><a href={record.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{record.title}</a></h3>
        {record.summary && record.summary !== record.title && <p className="mt-3 text-sm leading-relaxed text-ink-80"><strong>What it does:</strong> {record.summary} <span className="text-xs text-ink-60">({record.summarySource === "official" ? "official summary" : "AI-written summary of the bill; the official record shows the exact version voted"})</span></p>}
        {record.question && <p className="mt-3 text-sm leading-relaxed text-ink-80"><strong>Question before the chamber:</strong> {record.question}</p>}
        {record.meaning && <p className="mt-1 text-xs leading-relaxed text-ink-60">{record.meaning} (AI-written)</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="py-1 font-semibold text-ink-80">{record.outcome}</span>{record.kind === "procedural" && <span className={chip}>Procedural</span>}{split && <span className={chip}>{split}</span>}{record.close && <span className={chip}>Close</span>}{breakdown && <span className="py-1 text-ink-60">{breakdown}</span>}</div>
        {repsSplit(record) && <p className="mt-3 text-sm font-semibold text-ink-80">Your representatives split on this vote</p>}
        {record.representatives.length > 0 && <div className="mt-5 divide-y divide-hairline-soft border-t border-hairline-soft">{record.representatives.map((rep) => <div key={rep.id} className="flex items-center justify-between gap-4 py-3"><div><Link href={`/official/${rep.id}${address ? `?address=${encodeURIComponent(address)}` : ""}`} className="text-sm font-semibold text-ink underline decoration-chip-border underline-offset-4">{rep.name}</Link><p className="mt-1 text-xs text-ink-60">{rep.role}{rep.broke && " · Voted against most of their party"}</p></div><span className={`shrink-0 rounded-md border px-3 py-1.5 text-sm font-semibold ${rep.vote === "yes" ? "border-accent-tint-border bg-accent-tint text-accent-deep" : rep.vote === "no" ? "border-umber-tint-border bg-umber-tint text-umber-deep" : "border-dashed border-chip-border text-ink-60"}`}>{rep.vote === "yes" ? "Yes" : rep.vote === "no" ? "No" : rep.vote === "present" ? "Present" : "Not voting"}</span></div>)}</div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 border-t border-hairline-soft bg-canvas/40 px-5 text-xs sm:px-6"><span className="py-3 text-ink-60">{record.topics.length > 0 && `Matched topics: ${record.topics.map((id) => ISSUE_TOPICS.find((topic) => topic.id === id)?.label).join(" · ")}`}</span><a href={record.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-accent-deep underline underline-offset-4">Read the official record ↗</a></div>
    </article>;
  });
}
