"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ISSUE_TOPICS, LOCAL_SHOW, SHOW_OPTIONS, SORT_OPTIONS } from "@/lib/issues";

const fieldClass = "min-h-11 w-full border border-chip-border bg-paper-raised px-3 text-sm text-ink outline-offset-4 focus:outline-accent";
const PAGE_SIZE = 12;
const n = (value: number) => value.toLocaleString("en-US");

/**
 * Filter controls for /votes. The filters live in the URL: every change calls
 * router.replace and the server page re-renders the matching cards (passed in
 * as children), so the browser never receives the full record list.
 */
export function IssueExplorer({ topics, query, chamber, kind, show, sort, state, states, limit, total, topicCounts, chambers, countLine, local = false, children }: {
  topics: string[]; query: string; chamber: string; kind: string; show: string; sort: string; state: string; states: Array<{ value: string; label: string }>; limit: number; total: number;
  topicCounts: Record<string, number>; chambers: Array<{ value: string; label: string }>; countLine: string; local?: boolean; children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query);
  const [syncedQuery, setSyncedQuery] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Follow the URL when it changes under us (back/forward, reset).
  if (query !== syncedQuery) { setSyncedQuery(query); setText(query); }
  useEffect(() => () => clearTimeout(timer.current), []);

  function go(patch: Record<string, string>, keepLimit = false) {
    clearTimeout(timer.current);
    const params = new URLSearchParams(window.location.search);
    if (!keepLimit) params.delete("limit");
    for (const [key, value] of Object.entries({ q: text.trim(), ...patch })) {
      if (value) params.set(key, value); else params.delete(key);
    }
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `/votes?${qs}` : "/votes", { scroll: false }));
  }
  const toggleTopic = (id: string) => go({ topic: (topics.includes(id) ? topics.filter((t) => t !== id) : [...topics, id]).join(",") });
  function type(value: string) {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setSyncedQuery(value.trim()); go({ q: value.trim() }); }, 250);
  }
  const reset = () => { setText(""); setSyncedQuery(""); go({ topic: "", q: "", chamber: "", state: "", kind: "", show: "", sort: "" }); };
  const showOptions = local ? [...SHOW_OPTIONS, LOCAL_SHOW] : SHOW_OPTIONS;

  return (
    <div>
      {/* Carry the filters along when the address form is submitted. */}
      {[["topic", topics.join(",")], ["q", text.trim()], ["chamber", chamber], ["state", state], ["kind", kind], ["show", show], ["sort", sort]].map(([name, value]) => value && <input key={name} type="hidden" form="issue-address-form" name={name} value={value} />)}
      <section aria-labelledby="choose-topics" className="py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="choose-topics" className="font-serif text-2xl font-semibold text-ink">What do you want to look into?</h2>
          <span className="text-xs text-ink-60">Choose any topics · no selection shows everything</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ISSUE_TOPICS.map((topic) => {
            const count = topicCounts[topic.id] ?? 0;
            return <button key={topic.id} type="button" aria-pressed={topics.includes(topic.id)} onClick={() => toggleTopic(topic.id)} className={`group min-h-24 border p-3 text-left transition-colors sm:p-4 ${topics.includes(topic.id) ? "border-accent bg-accent-tint ring-1 ring-accent" : "border-card bg-paper-raised hover:border-accent"}`}>
              <span className="block text-sm font-semibold text-ink">{topic.label}</span>
              <span className="mt-1 hidden text-xs text-ink-60 sm:block">{topic.description}</span>
              <span className="mt-2 block text-xs text-ink-60">{n(count)} {count === 1 ? "vote" : "votes"}</span>
            </button>;
          })}
        </div>
        <button type="button" aria-pressed={topics.includes("other")} onClick={() => toggleTopic("other")} className={`mt-3 min-h-11 rounded-[2px] border px-3 text-xs ${topics.includes("other") ? "border-accent bg-accent-tint text-accent-deep" : "border-chip-border text-ink-60"}`}>Other / unclassified · {n(topicCounts.other ?? 0)} votes</button>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-60">Topics use keyword matches in bill titles, available summaries and vote questions. A bill can appear in several topics; a match does not tell you whether a vote advances or opposes an issue. Use search and unclassified records to find what the tags miss.</p>
      </section>

      <section aria-labelledby="record-results" className="border-t border-card pt-7">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <label className="col-span-2 text-xs font-semibold text-ink-60 lg:col-span-1">Search titles, bill numbers, summaries & vote questions<input className={`${fieldClass} mt-2`} value={text} onChange={(event) => type(event.target.value)} placeholder="Try rent, H.R. 25 or student loans" type="search" /></label>
          <label className="text-xs font-semibold text-ink-60">State<select className={`${fieldClass} mt-2`} value={state} onChange={(event) => go({ state: event.target.value, chamber: "" })}><option value="">All states and Congress</option>{states.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="text-xs font-semibold text-ink-60">Chamber<select className={`${fieldClass} mt-2`} value={chamber} onChange={(event) => go({ chamber: event.target.value })}><option value="">All chambers</option>{chambers.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="text-xs font-semibold text-ink-60">Vote type<select className={`${fieldClass} mt-2`} value={kind} onChange={(event) => go({ kind: event.target.value })}><option value="">All vote types</option><option value="substantive">Final votes & amendments</option><option value="procedural">Procedural (scheduling, rules)</option></select></label>
          <label className="text-xs font-semibold text-ink-60">Show<select className={`${fieldClass} mt-2`} value={show || "split"} onChange={(event) => go({ show: event.target.value === "split" ? "" : event.target.value })}>{showOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="text-xs font-semibold text-ink-60">Sort<select className={`${fieldClass} mt-2`} value={sort || "contested"} onChange={(event) => go({ sort: event.target.value === "contested" ? "" : event.target.value })}>{SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-60">Procedural votes are about scheduling, rules or whether to take up a measure, not necessarily final passage.</p>
        <div className="my-5 flex items-center justify-between gap-3">
          <h2 id="record-results" aria-live="polite" className="text-sm font-semibold text-ink">{countLine}{pending && <span className="ml-2 font-normal text-ink-60">Updating…</span>}</h2>
          <button type="button" onClick={reset} className="min-h-11 shrink-0 text-xs text-accent-deep underline">Reset filters</button>
        </div>
        <div aria-busy={pending} className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {total === 0 ? <div className="border border-dashed border-card-strong p-8 text-center"><h3 className="font-serif text-xl text-ink">No matching records on file</h3><p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-ink-60">Try a broader search or another topic. Missing records reflect our coverage and tagging; they do not show that a representative took no action.</p><button type="button" onClick={reset} className="mt-4 min-h-11 bg-accent px-5 text-sm font-semibold text-white">Show all available votes</button></div> : <div className="space-y-4">{children}</div>}
          {total > 0 && <div className="mt-6 flex flex-col items-center gap-3"><p className="text-xs text-ink-60">Showing {n(Math.min(limit, total))} of {n(total)} matching votes · {sort ? "newest first" : "most contested first"}</p>{limit < total && <button type="button" onClick={() => go({ limit: String(limit + PAGE_SIZE) }, true)} className="min-h-11 border border-accent bg-paper-raised px-6 text-sm font-semibold text-accent-deep hover:bg-accent-tint">Show {n(Math.min(PAGE_SIZE, total - limit))} more votes</button>}</div>}
        </div>
      </section>
    </div>
  );
}
