import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/Link";
import { PartyChip } from "@/components/PartyChip";
import { SourceLink } from "@/components/SourceLink";
import { VoteBadge } from "@/components/VoteBadge";
import { partyName } from "@/lib/divisive";
import { SPLIT_LABELS, chamberLabel } from "@/lib/issues";
import { personHrefForOfficial } from "@/server/people";
import { getRollCallDetail, partySides, type PartyTally, type RollMember } from "@/server/rollcall";
import type { Party, VoteChoice } from "@/server/types";

type Params = Promise<{ snapshot: string; id: string }>;
const chip = "rounded border border-chip-border bg-neutral-chip px-2 py-1";
const COLUMNS: VoteChoice[] = ["yes", "no", "present", "absent"];
const short = (t: string) => (t.length > 90 ? `${t.slice(0, 87).trimEnd()}…` : t);
const decode = (id: string) => { try { return decodeURIComponent(id); } catch { return id; } };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { snapshot, id } = await params;
  const d = await getRollCallDetail(snapshot, decode(id));
  if (!d) return { title: "Vote not found — The Full Record" };
  const { roll } = d;
  return {
    title: `${roll.bill ? `${roll.bill}: ` : ""}${short(roll.title)} — how ${chamberLabel(d.snapshot.chamber)} voted · The Full Record`,
    description: `${roll.outcome}. ${d.total.yes} yes, ${d.total.no} no, ${d.total.absent} not voting${d.total.present ? `, ${d.total.present} present` : ""}. See how each member voted, with a link to the official record.`,
    referrer: "no-referrer",
  };
}

function Bar({ t }: { t: PartyTally }) {
  const sum = t.yes + t.no + t.present + t.absent || 1;
  const pct = (n: number) => `${(n / sum) * 100}%`;
  return <div aria-hidden="true" className="flex h-3 overflow-hidden rounded-sm border border-chip-border bg-paper">
    <span style={{ width: pct(t.yes) }} className="bg-accent" />
    <span style={{ width: pct(t.no) }} className="bg-umber-soft" />
    <span style={{ width: pct(t.present) }} className="bg-chip-border" />
    <span style={{ width: pct(t.absent), backgroundImage: "repeating-linear-gradient(45deg, var(--color-hairline-soft) 0 4px, var(--color-hatch-dark) 4px 8px)" }} />
  </div>;
}

function MemberRow({ m, vote }: { m: RollMember; vote?: boolean }) {
  return <li className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-sm">
    {m.officialId ? <Link href={personHrefForOfficial(m.officialId)} className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-chip-border underline-offset-4">{m.name}</Link> : <span className="inline-flex min-h-11 items-center text-ink-80">{m.name}</span>}
    {m.party && <PartyChip party={m.party as Party} label={m.party} />}
    {m.district && <span className="text-xs text-ink-60">{m.district}</span>}
    {vote && <span className="ml-auto"><VoteBadge vote={m.vote} compact /></span>}
  </li>;
}

export default async function VotePage({ params }: { params: Params }) {
  const { snapshot: file, id } = await params;
  const d = await getRollCallDetail(file, decode(id));
  if (!d) notFound();
  const { roll, split, members, tally, total } = d;
  const chamber = chamberLabel(d.snapshot.chamber);
  const broke = members.filter((m) => m.broke);
  const sides = partySides(split);
  const label = SPLIT_LABELS[split.kind];
  const rows = (["D", "R", "other"] as const).filter((p) => tally[p]);

  return <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-12 sm:px-6">
    <nav aria-label="Breadcrumb" className="pt-5 text-[12.5px] text-ink-60"><Link href="/votes" className="inline-flex min-h-11 items-center hover:text-ink">‹ Explore the votes</Link></nav>
    <header className="border-b border-card pb-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-semibold tracking-wide text-ink-60"><span>{chamber}</span><span aria-hidden="true">/</span><span>{roll.bill || "Vote"}</span><time className="sm:ml-auto" dateTime={roll.date}>{roll.dateLabel}</time></div>
      <h1 className="mt-3 font-serif text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">{roll.title}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="py-1 font-semibold text-ink-80">{roll.outcome}</span>{roll.kind === "procedural" && <span className={chip}>Procedural</span>}{label && <span className={chip}>{label}</span>}{split.close && <span className={chip}>Close</span>}</div>
      {roll.amendment?.purpose && <p className="mt-4 text-sm leading-relaxed text-ink-80"><strong>Amendment purpose (official):</strong> {roll.amendment.purpose}</p>}
      {roll.summary && roll.summary !== roll.title && <p className="mt-4 text-sm leading-relaxed text-ink-80"><strong>{roll.amendment ? "Bill summary:" : "What it does:"}</strong> {roll.summary} <span className="text-xs text-ink-60">({roll.summarySource === "official" ? "official summary" : "AI-written summary of the bill; the official record shows the exact version voted"})</span></p>}
      {roll.question && <p className="mt-3 text-sm leading-relaxed text-ink-80"><strong>Question before the chamber:</strong> {roll.question}</p>}
      {roll.meaning && <p className="mt-1 text-xs leading-relaxed text-ink-60">{roll.meaning} (AI-written)</p>}
      <p className="mt-4 text-sm"><SourceLink href={roll.sourceUrl} className="min-h-11">Read the official record</SourceLink></p>
    </header>

    <section aria-labelledby="tally" className="border-b border-card py-6">
      <h2 id="tally" className="font-serif text-2xl font-semibold text-ink">The tally</h2>
      <p className="mt-2 text-sm font-semibold text-ink-80">Yes {total.yes} · No {total.no} · Not voting {total.absent}{total.present > 0 && ` · Present ${total.present}`}</p>
      <div className="mt-2"><Bar t={total} /></div>
      <p className="mt-1 text-[11px] text-ink-60">Bar: green = yes, brown = no, striped = not voting.</p>
      {rows.length > 0 && <table className="mt-4 w-full text-left text-sm"><caption className="sr-only">Votes by party</caption><thead className="text-xs text-ink-60"><tr><th scope="col" className="py-1.5 pr-3 font-semibold">Party</th><th scope="col" className="py-1.5 pr-3 font-semibold">Yes</th><th scope="col" className="py-1.5 pr-3 font-semibold">No</th><th scope="col" className="py-1.5 font-semibold">Not voting{rows.some((p) => tally[p].present) && " / present"}</th></tr></thead><tbody className="divide-y divide-hairline-soft">{rows.map((p) => <tr key={p}><th scope="row" className="py-2 pr-3 font-semibold text-ink">{p === "other" ? "Other or unknown party" : partyName(p)}</th><td className="py-2 pr-3">{tally[p].yes}</td><td className="py-2 pr-3">{tally[p].no}</td><td className="py-2">{tally[p].absent}{tally[p].present > 0 && ` / ${tally[p].present}`}</td></tr>)}</tbody></table>}
      {(sides || broke.length > 0) && <p className="mt-4 text-sm leading-relaxed text-ink-80">{sides && `${sides}. `}{broke.length > 0 && `${broke.length} ${broke.length === 1 ? "member" : "members"} voted against their party’s majority.`}</p>}
    </section>

    {broke.length > 0 && <section aria-labelledby="broke" className="border-b border-card py-6">
      <h2 id="broke" className="font-serif text-2xl font-semibold text-ink">Voted against their party’s majority</h2>
      <ul className="mt-2 divide-y divide-hairline-soft">{broke.map((m) => <MemberRow key={m.key} m={m} vote />)}</ul>
    </section>}

    <section aria-labelledby="roll" className="py-6">
      <h2 id="roll" className="font-serif text-2xl font-semibold text-ink">The full roll ({members.length})</h2>
      {!d.namesOk && <p className="mt-2 text-xs text-ink-60">Member names could not be loaded right now; party and district appear where we have them. The official record lists every name.</p>}
      <div className="mt-3 grid gap-x-8 gap-y-6 md:grid-cols-2">
        {COLUMNS.map((vote) => {
          const list = members.filter((m) => m.vote === vote);
          return list.length > 0 && <div key={vote}><h3 className="text-sm font-semibold text-ink"><VoteBadge vote={vote} compact /> <span className="ml-1 text-ink-60">{list.length}</span></h3><ul className="mt-1 divide-y divide-hairline-soft">{list.map((m) => <MemberRow key={m.key} m={m} />)}</ul></div>;
        })}
      </div>
      <p className="mt-6 text-xs leading-relaxed text-ink-60">“Not voting” is a recorded non-vote, not a reason for the absence. Parties come from public rosters; <Link href="/coverage#party-splits" className="underline">how we count</Link>.</p>
    </section>
  </main>;
}
