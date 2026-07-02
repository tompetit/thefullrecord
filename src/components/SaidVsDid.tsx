"use client";

import { useMemo, useState } from "react";
import type { RelationshipLabel, SaidDidPair } from "@/server/types";
import { FilterChips } from "./FilterChips";
import { Glyph } from "./Glyph";
import { RelationshipPill } from "./RelationshipPill";
import { ReportIssue } from "./ReportIssue";
import { SourceLink } from "./SourceLink";
import { VoteBadge } from "./VoteBadge";

type LabelFilter = "all" | RelationshipLabel;

/**
 * Said vs. did — statement–vote pairs. Labels the relationship only,
 * never a verdict. Collapsed rows pair said → label → did; expanding
 * reveals full evidence blocks, each with its own source link.
 */
export function SaidVsDid({
  pairs,
  total,
}: {
  pairs: SaidDidPair[];
  total: number;
}) {
  const [labelFilter, setLabelFilter] = useState<LabelFilter>("all");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([pairs.find((p) => p.label === "in_tension")?.id ?? ""])
  );

  const counts = useMemo(() => {
    const c: Record<LabelFilter, number> = {
      all: pairs.length,
      consistent: 0,
      in_tension: 0,
      not_directly_related: 0,
    };
    for (const p of pairs) c[p.label]++;
    return c;
  }, [pairs]);

  const topics = useMemo(
    () => ["all", ...Array.from(new Set(pairs.map((p) => p.topic)))],
    [pairs]
  );

  const visible = pairs.filter(
    (p) =>
      (labelFilter === "all" || p.label === labelFilter) &&
      (topicFilter === "all" || p.topic === topicFilter)
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          value={labelFilter}
          onChange={setLabelFilter}
          options={[
            { value: "all", label: `All ${counts.all}` },
            { value: "consistent", label: `Consistent ${counts.consistent}` },
            { value: "in_tension", label: `In tension ${counts.in_tension}` },
            {
              value: "not_directly_related",
              label: `Not directly related ${counts.not_directly_related}`,
            },
          ]}
        />
        <label className="flex min-h-11 items-center gap-1.5 font-sans text-xs text-ink-60">
          Topic:
          <select
            value={topicFilter}
            onChange={(e) => setTopicFilter(e.target.value)}
            className="cursor-pointer rounded-md border border-chip-border bg-paper-raised px-2 py-1 font-sans text-xs text-ink-80"
          >
            {topics.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "All" : t}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="font-sans text-[11.5px] leading-normal text-ink-45">
        Labels describe one statement next to one vote — never an overall
        judgment of an official. Pairs are matched by subject, then reviewed.{" "}
        <SourceLink href="#" className="text-[11.5px]">
          Methodology
        </SourceLink>
      </p>

      <div className="flex flex-col gap-3">
        {visible.map((pair) =>
          expanded.has(pair.id) ? (
            <ExpandedPair key={pair.id} pair={pair} onCollapse={() => toggle(pair.id)} />
          ) : (
            <CollapsedPair key={pair.id} pair={pair} onExpand={() => toggle(pair.id)} />
          )
        )}
      </div>

      <p className="font-sans text-xs text-ink-60">
        Showing {visible.length} of {total} pairs ·{" "}
        <button type="button" className="cursor-pointer underline">
          See all
        </button>
      </p>
    </div>
  );
}

function CollapsedPair({
  pair,
  onExpand,
}: {
  pair: SaidDidPair;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="grid cursor-pointer grid-cols-1 items-center gap-3 rounded-lg border border-card bg-paper-raised p-4 text-left shadow-card transition-shadow duration-150 hover:shadow-card-raised lg:grid-cols-[1fr_auto_1fr_auto]"
    >
      <span className="flex flex-col gap-1">
        <span className="font-sans text-[10.5px] font-bold tracking-[0.07em] text-ink-45">
          SAID · {pair.topic.toUpperCase()} · {pair.saidEyebrowDate}
        </span>
        <span className="font-serif text-[15px] leading-[1.45] text-ink">
          “{pair.said.text}”
        </span>
      </span>
      <span className="justify-self-start lg:justify-self-center">
        <RelationshipPill label={pair.label} />
      </span>
      <span className="flex flex-col gap-1">
        <span className="font-sans text-[10.5px] font-bold tracking-[0.07em] text-ink-45">
          DID · {pair.didEyebrowDate}
        </span>
        <span className="font-sans text-[13px] leading-[1.5] text-ink-80">
          {pair.did.text}
        </span>
      </span>
      <span className="inline-flex items-center gap-1 font-sans text-xs text-ink-60 lg:self-center">
        Expand <Glyph name="chevron-down" />
      </span>
    </button>
  );
}

function ExpandedPair({
  pair,
  onCollapse,
}: {
  pair: SaidDidPair;
  onCollapse: () => void;
}) {
  return (
    <article className="rounded-lg border border-card-strong bg-paper-raised p-4 shadow-card-raised">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-sans text-[10.5px] font-bold tracking-[0.07em] text-ink-45">
          {pair.topic.toUpperCase()}
        </span>
        <RelationshipPill label={pair.label} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-hairline-soft bg-paper p-4">
          <div className="font-sans text-[10.5px] font-bold tracking-[0.07em] text-ink-45">
            SAID
          </div>
          <p className="mt-2 font-serif text-[15.5px] leading-[1.45] text-ink">
            “{pair.said.text}”
          </p>
          <p className="mt-3 font-sans text-xs text-ink-60">
            {pair.said.sourceName} · {pair.said.dateLabel} ·{" "}
            <SourceLink href={pair.said.sourceUrl} className="text-xs">
              Source
            </SourceLink>
          </p>
        </div>
        <div className="rounded-lg border border-hairline-soft bg-paper p-4">
          <div className="font-sans text-[10.5px] font-bold tracking-[0.07em] text-ink-45">
            DID
          </div>
          <div className="mt-2 flex items-start justify-between gap-3">
            <p className="font-sans text-[13.5px] leading-[1.5] text-ink-80">
              {pair.did.text}
            </p>
            <VoteBadge vote={pair.did.vote} compact />
          </div>
          <p className="mt-3 font-sans text-xs text-ink-60">
            {pair.did.sourceName} · {pair.did.dateLabel} ·{" "}
            <SourceLink href={pair.did.sourceUrl} className="text-xs">
              Source
            </SourceLink>
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline-soft pt-3 font-sans text-xs text-ink-60">
        {pair.whyNote && (
          <span className="min-w-0 flex-1 basis-full lg:basis-auto">
            {pair.whyNote}{" "}
            <SourceLink href="#" className="text-xs">
              Why this label
            </SourceLink>
          </span>
        )}
        <ReportIssue subjectType="said_vs_did" subjectId={pair.id} />
        <button
          type="button"
          onClick={onCollapse}
          className="ml-auto inline-flex min-h-11 cursor-pointer items-center gap-1 font-sans text-xs text-ink-60 underline"
        >
          Collapse <Glyph name="chevron-up" />
        </button>
      </div>
    </article>
  );
}
