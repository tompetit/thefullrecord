"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ISSUE_TOPICS, filterIssueRecords, parseIssueTopics, type IssueRecord } from "@/lib/issues";

const fieldClass = "min-h-11 w-full rounded-lg border border-chip-border bg-paper-raised px-3 text-sm text-ink outline-offset-4 focus:outline-accent";
const PAGE_SIZE = 12;

export function IssueExplorer({ records, initialTopic = "", local = false, address = "" }: { records: IssueRecord[]; initialTopic?: string; local?: boolean; address?: string }) {
  const [topics, setTopics] = useState<string[]>(parseIssueTopics(initialTopic));
  const [query, setQuery] = useState("");
  const [chamber, setChamber] = useState("");
  const [kind, setKind] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const chambers = useMemo(() => [...new Set(records.map((record) => record.chamber))].sort(), [records]);
  const filtered = useMemo(() => filterIssueRecords(records, { topics, query, chamber, kind }), [records, topics, query, chamber, kind]);
  function updateTopics(next: string[]) {
    setTopics(next);
    const url = new URL(window.location.href);
    if (next.length) url.searchParams.set("topic", next.join(","));
    else url.searchParams.delete("topic");
    window.history.replaceState(null, "", url);
    setLimit(PAGE_SIZE);
  }
  function toggleTopic(id: string) {
    updateTopics(topics.includes(id) ? topics.filter((topic) => topic !== id) : [...topics, id]);
  }
  function reset() { updateTopics([]); setQuery(""); setChamber(""); setKind(""); }
  const otherCount = records.filter((record) => !record.topics.length).length;

  return (
    <div>
      <input type="hidden" form="issue-address-form" name="topic" value={topics.join(",")} />
      <section aria-labelledby="choose-topics" className="py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="choose-topics" className="font-serif text-2xl font-semibold text-ink">What do you want to look into?</h2>
          <span className="text-xs text-ink-60">Choose any topics · no selection shows everything</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ISSUE_TOPICS.map((topic, index) => {
            const count = records.filter((record) => record.topics.includes(topic.id)).length;
            return <button key={topic.id} type="button" aria-pressed={topics.includes(topic.id)} onClick={() => toggleTopic(topic.id)} className={`group min-h-24 rounded-lg border p-3 text-left transition-colors sm:p-4 ${topics.includes(topic.id) ? "border-accent bg-accent-tint ring-1 ring-accent" : "border-card bg-paper-raised hover:border-accent"}`}>
              <span className="flex items-center justify-between gap-2 font-mono text-[10px] text-ink-60"><span>0{index + 1}</span><span>{count} {count === 1 ? "vote" : "votes"}</span></span>
              <span className="mt-2 block text-sm font-semibold text-ink">{topic.label}</span>
              <span className="mt-1 hidden text-xs text-ink-60 sm:block">{topic.description}</span>
            </button>;
          })}
        </div>
        <button type="button" aria-pressed={topics.includes("other")} onClick={() => toggleTopic("other")} className={`mt-3 min-h-11 rounded-md border px-3 text-xs ${topics.includes("other") ? "border-accent bg-accent-tint text-accent-deep" : "border-chip-border text-ink-60"}`}>Other / unclassified · {otherCount} votes</button>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-60">Topics use keyword matches in bill titles, available summaries and vote questions. A bill can appear in several topics; a match does not tell you whether a vote advances or opposes an issue. Use search and unclassified records to find what the tags miss.</p>
      </section>

      <section aria-labelledby="record-results" className="border-t border-card pt-7">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <label className="text-xs font-semibold text-ink-60">Search titles, bill numbers, summaries & vote questions<input className={`${fieldClass} mt-2`} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} placeholder="Try rent, H.R. 25 or student loans" type="search" /></label>
          <label className="text-xs font-semibold text-ink-60">Chamber<select className={`${fieldClass} mt-2`} value={chamber} onChange={(event) => { setChamber(event.target.value); setLimit(PAGE_SIZE); }}><option value="">All chambers</option>{chambers.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs font-semibold text-ink-60">Vote type<select className={`${fieldClass} mt-2`} value={kind} onChange={(event) => { setKind(event.target.value); setLimit(PAGE_SIZE); }}><option value="">All vote types</option><option value="substantive">Substantive</option><option value="procedural">Procedural</option></select></label>
        </div>
        <div className="my-5 flex items-center justify-between gap-3">
          <h2 id="record-results" aria-live="polite" className="text-sm font-semibold text-ink">{filtered.length} recorded roll {filtered.length === 1 ? "call" : "calls"}{local ? " for these representatives" : " on file"}</h2>
          <button type="button" onClick={reset} className="min-h-11 shrink-0 text-xs text-accent-deep underline">Reset filters</button>
        </div>
        {filtered.length === 0 ? <div className="rounded-xl border border-dashed border-card-strong p-8 text-center"><h3 className="font-serif text-xl text-ink">No matching records on file</h3><p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-ink-60">Try a broader search or another topic. Missing records reflect our coverage and tagging; they do not show that an official took no action.</p><button type="button" onClick={reset} className="mt-4 min-h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-white">Show all available votes</button></div> : <div className="space-y-4">
          {filtered.slice(0, limit).map((record) => <article key={record.id} className="overflow-hidden rounded-xl border border-card bg-paper-raised">
            <div className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-semibold tracking-wide text-ink-60"><span>{record.chamber}</span><span aria-hidden="true">/</span><span>{record.bill || "Roll call"}</span><time className="sm:ml-auto" dateTime={record.date}>{record.dateLabel}</time></div>
              <h3 className="mt-3 font-serif text-xl font-semibold leading-snug text-ink"><a href={record.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{record.title}</a></h3>
              {record.question && <p className="mt-3 text-sm leading-relaxed text-ink-80"><strong>Question before the chamber:</strong> {record.question}</p>}
              <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded border border-chip-border bg-neutral-chip px-2 py-1">{record.kind === "procedural" ? "Procedural vote" : "Substantive vote"}</span><span className="py-1 font-semibold text-ink-80">{record.outcome}</span></div>
              {record.kind === "procedural" && <p className="mt-3 text-xs leading-relaxed text-ink-60">This is a vote on a procedural question, such as whether to take up or advance a measure. It is not necessarily a vote on final passage.</p>}
              {record.summary && record.summary !== record.title && <details className="mt-4 text-sm"><summary className="min-h-9 cursor-pointer text-accent-deep underline underline-offset-4">Read {record.summarySource === "official" ? "official" : "AI-generated"} summary</summary><p className="mt-2 leading-relaxed text-ink-80">{record.summary}</p><p className="mt-2 text-xs text-ink-60">{record.summarySource === "official" ? "Summary supplied by the official source." : "AI-generated summary; check the primary source for the full context."}</p></details>}
              {record.representatives.length > 0 && <div className="mt-5 divide-y divide-hairline-soft border-t border-hairline-soft">{record.representatives.map((rep) => <div key={rep.id} className="flex items-center justify-between gap-4 py-3"><div><Link href={`/official/${rep.id}${address ? `?address=${encodeURIComponent(address)}` : ""}`} className="text-sm font-semibold text-ink underline decoration-chip-border underline-offset-4">{rep.name}</Link><p className="mt-1 text-xs text-ink-60">{rep.role}</p></div><span className={`shrink-0 rounded-md border px-3 py-1.5 text-sm font-semibold ${rep.vote === "yes" ? "border-accent-tint-border bg-accent-tint text-accent-deep" : rep.vote === "no" ? "border-umber-tint-border bg-umber-tint text-umber-deep" : "border-dashed border-chip-border text-ink-60"}`}>{rep.vote === "yes" ? "Yes" : rep.vote === "no" ? "No" : rep.vote === "present" ? "Present" : "Not voting"}</span></div>)}</div>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline-soft bg-canvas/40 px-5 py-3 text-xs sm:px-6"><span className="text-ink-60">{record.topics.map((id) => ISSUE_TOPICS.find((topic) => topic.id === id)?.label).join(" · ") || "Unclassified"}</span><a href={record.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center font-semibold text-accent-deep underline underline-offset-4">Read the official record ↗</a></div>
          </article>)}
        </div>}
        {filtered.length > 0 && <div className="mt-6 flex flex-col items-center gap-3"><p className="text-xs text-ink-60">Showing {Math.min(limit, filtered.length)} of {filtered.length} matching roll calls · newest first</p>{limit < filtered.length && <button type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)} className="min-h-11 rounded-lg border border-accent bg-paper-raised px-6 text-sm font-semibold text-accent-deep hover:bg-accent-tint">Show {Math.min(PAGE_SIZE, filtered.length - limit)} more votes</button>}</div>}
      </section>
    </div>
  );
}
