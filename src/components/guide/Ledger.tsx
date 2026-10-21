import { getKeyVoteDefs, getPartyTally } from "@/server/guide/load";
import {
  ISSUES,
  type Finance,
  type GuideCandidate,
  type GuideRace,
  type PartyLine,
  type PartyTally,
  type Position,
} from "@/server/guide/types";
import { Cites, PartyChips, money } from "./ui";

/** Ledger-style building blocks for candidate pages: party-line vote record, said vs. did, money. */

const PARTY_NOUN: Record<string, string> = { D: "Democrats", R: "Republicans" };

/** The party a candidate's votes are compared with (independents: the caucus scored by the data). */
export function caucusOf(c: GuideCandidate): "D" | "R" | null {
  if (c.parties.includes("D")) return "D";
  if (c.parties.includes("R")) return "R";
  return c.keyVotes?.some((v) => v.partyLine) ? "D" : null;
}

export interface VoteRow {
  key: string;
  date: string;
  title: string;
  meta: string;
  summary?: string;
  vote: "yes" | "no" | "nv";
  partyLine?: PartyLine;
  tally?: PartyTally;
  url: string;
  urlLabel: string;
}

/** Congressional key votes and NY floor votes as one dated list, newest first. */
export function voteRows(c: GuideCandidate): VoteRow[] {
  const defs = new Map(getKeyVoteDefs().map((d) => [d.id, d]));
  const fed: VoteRow[] = (c.keyVotes ?? []).flatMap((kv) => {
    const d = defs.get(kv.voteId);
    if (!d) return [];
    return [
      {
        key: kv.voteId,
        date: d.date,
        title: d.shortTitle,
        meta: `${d.bill} · ${d.result} ${d.yea}–${d.nay}`,
        summary: d.summary,
        vote: kv.vote === "yes" ? "yes" : kv.vote === "no" ? "no" : "nv",
        partyLine: kv.partyLine,
        tally: getPartyTally(kv.voteId),
        url: d.sourceUrl,
        urlLabel: "roll call",
      },
    ];
  });
  const state: VoteRow[] = (c.stateVotes ?? []).map((v) => ({
    key: `${v.chamber}|${v.bill}|${v.date}`,
    date: v.date,
    title: v.title,
    meta: `${v.bill} · ${v.outcome}`,
    summary: v.summary,
    vote: v.vote === "absent" ? "nv" : v.vote,
    partyLine: v.partyLine,
    tally: v.partyTally,
    url: v.sourceUrl,
    urlLabel: "official record",
  }));
  return [...fed, ...state].sort((a, b) => b.date.localeCompare(a.date));
}

const VOTE_LABEL = { yes: "Yes", no: "No", nv: "Didn't vote" } as const;

export function PartyLineBadge({ line, vote }: { line?: PartyLine; vote: VoteRow["vote"] }) {
  if (vote === "nv")
    return <span className="inline-block w-full rounded-[2px] border border-dashed border-dash-border px-1.5 py-px text-center font-mono text-[10.5px] font-semibold text-ink-45">No vote</span>;
  if (!line)
    return <span className="inline-block w-full rounded-[2px] border border-chip-border px-1.5 py-px text-center font-mono text-[10.5px] font-semibold text-ink-60">Split party</span>;
  return line === "with" ? (
    <span className="inline-block w-full rounded-[2px] bg-accent px-1.5 py-px text-center font-mono text-[10.5px] font-semibold text-paper-raised">With party</span>
  ) : (
    <span className="inline-block w-full rounded-[2px] bg-umber px-1.5 py-px text-center font-mono text-[10.5px] font-semibold text-paper-raised">Against party</span>
  );
}

function tallyText(t: PartyTally | undefined): string | null {
  if (!t) return null;
  const parts = (["D", "R"] as const).flatMap((p) => (t[p] ? [`${PARTY_NOUN[p]} ${t[p]!.yes}–${t[p]!.no}`] : []));
  return parts.length ? parts.join(" · ") : null;
}

/** Overview module: how often the candidate voted with their party, and the votes where they broke from it. */
export function PartyLineModule({ c, rows }: { c: GuideCandidate; rows: VoteRow[] }) {
  const caucus = caucusOf(c);
  const scored = rows.filter((r) => r.partyLine);
  const withN = scored.filter((r) => r.partyLine === "with").length;
  const against = scored.filter((r) => r.partyLine === "against");
  const nv = rows.filter((r) => r.vote === "nv").length;
  const total = withN + against.length + nv;
  if (!rows.length || !caucus)
    return (
      <>
        <ModHead title="Party line" note="none" />
        <div className="h-3.5 rounded-[2px] border-[1.5px] border-dashed border-card" />
        <p className="mt-2.5 font-sans text-[12px] leading-snug text-ink-60">
          {rows.length ? "Not scored against a party." : "No recorded floor votes — not a current legislator in our records."}
        </p>
      </>
    );
  const pct = (n: number) => `${(n / Math.max(total, 1)) * 100}%`;
  return (
    <>
      <ModHead title="Party line" note={`${rows.length} votes tracked`} />
      <div className="flex h-3.5 overflow-hidden rounded-[2px] bg-canvas" role="img" aria-label={`${withN} with ${PARTY_NOUN[caucus]}, ${against.length} against, ${nv} not voting`}>
        <i className="block h-full bg-accent" style={{ width: pct(withN) }} />
        <i className="block h-full bg-umber" style={{ width: pct(against.length) }} />
        <i className="block h-full bg-[repeating-linear-gradient(45deg,var(--color-not-voting)_0_2px,transparent_2px_5px)]" style={{ width: pct(nv) }} />
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {[
          { n: withN, label: `With ${PARTY_NOUN[caucus]}`, sw: "bg-accent" },
          { n: against.length, label: "Against", sw: "bg-umber" },
          { n: nv, label: "Didn't vote", sw: "bg-not-voting" },
        ].map((t) => (
          <div key={t.label} className="font-sans text-[12px] leading-tight text-ink-60">
            <b className="block font-mono text-[24px] font-semibold leading-[1.1] text-ink tabular-nums">{t.n}</b>
            <span className={`mr-1.5 inline-block size-2 rounded-[1px] ${t.sw}`} />
            {t.label}
          </div>
        ))}
      </div>
      {against.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-2">
          <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-45">Broke with {PARTY_NOUN[caucus]} on</p>
          <ul className="mt-1 flex flex-col gap-0.5 font-sans text-[12.5px] leading-snug text-ink-80">
            {against.slice(0, 4).map((r) => (
              <li key={r.key}>
                <a href={`#vote-${r.key}`} className="hover:underline">
                  {r.title}
                </a>{" "}
                <span className="font-mono text-[11px] text-ink-45">voted {VOTE_LABEL[r.vote].toLowerCase()}</span>
              </li>
            ))}
            {against.length > 4 && <li className="text-ink-45">and {against.length - 4} more below</li>}
          </ul>
        </div>
      )}
      <p className="mt-2 font-sans text-[11.5px] leading-snug text-ink-45">
        With party = voted the same way as most {PARTY_NOUN[caucus]} who voted.
      </p>
    </>
  );
}

export function ModHead({ title, note }: { title: string; note?: string }) {
  return (
    <h2 className="mb-3 flex items-baseline justify-between gap-2 font-sans text-[12px] font-bold uppercase tracking-[0.06em] text-ink">
      {title}
      {note && <small className="font-mono text-[11px] font-medium normal-case tracking-normal text-ink-45">{note}</small>}
    </h2>
  );
}

/** Overview module: the race at a glance. */
export function BallotModule({ race, c }: { race: GuideRace; c: GuideCandidate }) {
  return (
    <>
      <ModHead title="On the ballot" note={race.district ? `${race.office} · ${race.district}` : race.office} />
      <p className="font-mono text-[22px] font-semibold leading-[1.1] text-ink">{race.electionDate}</p>
      <table className="mt-2 w-full border-collapse font-sans text-[13px]">
        <tbody>
          {race.candidates.map((o) => (
            <tr key={o.id} className="border-t border-hairline">
              <td className="py-1.5 pr-2 align-top">
                {o.id === c.id ? <b className="font-semibold text-ink">{o.name}</b> : <a href={`/guide/race/${race.id}/${o.id}`} className="text-ink-80 hover:underline">{o.name}</a>}{" "}
                <span className="inline-flex gap-0.5 align-[1px]"><PartyChips parties={o.parties} /></span>
              </td>
              <td className="whitespace-nowrap py-1.5 text-right align-top font-mono text-[11.5px] text-ink-45">{o.incumbent ? "incumbent" : "challenger"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {c.ballotNote && <p className="mt-2 font-sans text-[11.5px] leading-snug text-ink-45">{c.ballotNote}</p>}
    </>
  );
}

/** The dated vote log, with the party-line verdict first and the actual vote beside it. */
export function VoteTable({ rows, limit, compact }: { rows: VoteRow[]; limit?: number; compact?: boolean }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <div className="overflow-x-auto border border-card bg-paper-raised">
      <table className="w-full border-collapse font-sans text-[13px]">
        <thead>
          <tr className="bg-canvas text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-45">
            <th className="px-3 py-2 font-semibold">Date</th>
            <th className="px-3 py-2 font-semibold">Party line</th>
            <th className="px-3 py-2 font-semibold">Measure</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const t = tallyText(r.tally);
            return (
              <tr key={r.key} id={`vote-${r.key}`} className="scroll-mt-4 border-t border-hairline align-top">
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] text-ink-45 tabular-nums">{r.date}</td>
                <td className="w-[124px] px-3 py-2.5">
                  <PartyLineBadge line={r.partyLine} vote={r.vote} />
                  <span className="mt-1 block text-center font-mono text-[11px] text-ink-60">voted {VOTE_LABEL[r.vote].toLowerCase()}</span>
                </td>
                <td className={`${compact ? "min-w-[180px]" : "min-w-[220px]"} px-3 py-2.5`}>
                  <b className="font-semibold text-ink" title={compact ? r.summary : undefined}>{r.title}</b>
                  <span className="block font-mono text-[11.5px] leading-snug text-ink-45">
                    {r.meta} ·{" "}
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                      {r.urlLabel} ↗
                    </a>
                  </span>
                  {t && <span className="block font-mono text-[11.5px] leading-snug text-ink-60">{t}</span>}
                  {r.summary && !compact && <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-60">{r.summary}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {limit && rows.length > limit && (
        <p className="border-t border-hairline px-3 py-2 font-sans text-[12px] text-ink-45">Showing the {limit} most recent of {rows.length} votes.</p>
      )}
    </div>
  );
}

const STANCE_CHIP = {
  supports: { w: "Supports", cls: "bg-accent-tint text-accent", m: "✓" },
  opposes: { w: "Opposes", cls: "bg-umber-tint text-umber", m: "✕" },
  mixed: { w: "Mixed", cls: "bg-neutral-chip text-ink-60", m: "~" },
  not_inferred: { w: "Recorded votes", cls: "bg-neutral-chip text-ink-60", m: "○" },
} as const;

/** Said vs. did: each documented statement beside the recorded votes mapped to the same issue. */
export function SaidVsDidTable({ race, positions }: { race: GuideRace; positions: Position[] }) {
  return (
    <div className="border border-card bg-paper-raised">
      <div className="hidden grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] border-b border-card bg-canvas font-mono text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-45 md:grid">
        <div className="px-4 py-2">Issue</div>
        <div className="px-4 py-2">What they said</div>
        <div className="px-4 py-2">How they voted</div>
      </div>
      {positions.map((p) => {
        const said = p.basis === "votes" ? p.stated : { stance: p.stance, summary: p.summary, quote: p.quote, sources: p.sources };
        const votes = p.votes ?? [];
        const comparable = said && (said.stance === "supports" || said.stance === "opposes") ? votes.filter((v) => v.yesMeans) : [];
        const same = comparable.filter((v) => (v.vote === "yes") === (v.yesMeans === said!.stance)).length;
        const chip = said ? STANCE_CHIP[said.stance] : null;
        return (
          <div key={p.issue} className="grid border-b border-card last:border-b-0 md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-2 px-4 pt-3.5 font-sans text-[15px] font-bold leading-tight text-ink md:py-3.5">
              {ISSUES[p.issue]}
              {chip && (
                <span className={`inline-flex w-fit items-center gap-1 rounded-[2px] px-1.5 py-px text-[11px] font-bold ${chip.cls}`}>
                  <span aria-hidden>{chip.m}</span>
                  {chip.w}
                </span>
              )}
            </div>
            <div className="min-w-0 px-4 py-3 md:border-l md:border-hairline md:py-3.5">
              {said ? (
                <>
                  {said.quote ? (
                    <q className="block font-serif text-[16px] leading-[1.45] text-ink">{said.quote}</q>
                  ) : (
                    <p className="font-serif text-[15px] leading-[1.45] text-ink-80">{said.summary}</p>
                  )}
                  <p className="mt-1.5 font-mono text-[11.5px] text-ink-45">
                    {said.quote ? said.summary : "Documented position"}
                    <Cites ids={said.sources} race={race} />
                  </p>
                </>
              ) : (
                <p className="font-serif text-[14.5px] italic leading-[1.45] text-ink-45">No statement on this issue in our sources.</p>
              )}
            </div>
            <div className="min-w-0 px-4 pb-3.5 pt-1 md:border-l md:border-hairline md:py-3.5">
              {votes.length ? (
                <>
                  <ul className="grid gap-2">
                    {votes.map((v, i) => (
                      <li key={i} className="grid grid-cols-[38px_minmax(0,1fr)] gap-2.5 font-sans text-[13px] leading-snug">
                        <span className={`h-5 rounded-[2px] text-center font-mono text-[11px] font-semibold leading-5 text-paper-raised ${v.vote === "yes" ? "bg-accent" : "bg-umber"}`}>
                          {v.vote === "yes" ? "YES" : "NO"}
                        </span>
                        <span className="text-ink-80">
                          {v.text.replace(/^Voted (yes|no) on /, "")}
                          <Cites ids={v.sources} race={race} />
                        </span>
                      </li>
                    ))}
                  </ul>
                  {comparable.length > 0 && (
                    <p className="mt-2.5 w-fit bg-accent-tint px-2 py-1 font-mono text-[11.5px] font-semibold text-accent-deep">
                      {same} of {comparable.length} vote{comparable.length === 1 ? "" : "s"} point the same way as the statement
                    </p>
                  )}
                </>
              ) : (
                <p className="font-serif text-[14.5px] italic leading-[1.45] text-ink-45">No recorded floor vote in our key-vote set maps to this issue.</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Meter({ label, value, max, cls }: { label: string; value: number; max: number; cls: string }) {
  return (
    <div className="mb-2.5 grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1">
      <span className="font-sans text-[12px] text-ink-60">{label}</span>
      <span className="font-mono text-[14px] font-semibold text-ink tabular-nums">{money(value)}</span>
      <span className="col-span-2 h-1.5 rounded-[1px] bg-canvas">
        <span className={`block h-full rounded-[1px] ${cls}`} style={{ width: `${Math.min(100, (Math.max(value, 0) / Math.max(max, 1)) * 100)}%` }} />
      </span>
    </div>
  );
}

const SMALL = new Set(["of", "and", "on", "for", "the", "to", "in", "a", "an", "at", "by"]);
const KEEP_CAPS = /^(PAC|AFL-CIO|LLC|USA|US|II|III|NEA|SEIU|COPE|IBEW|UAW|AFSCME|NRA|NEA|DC|NY)$/;
/** FEC names are all caps; set them in title case, keeping acronyms (and short words in parentheses) as written. */
const titleCase = (s: string) =>
  s.length > 6 && s === s.toUpperCase()
    ? s
        .split(" ")
        .map((w, i) => {
          const bare = w.replace(/[^A-Z-]/g, "");
          if (KEEP_CAPS.test(bare) || (/^\(/.test(w) && bare.length <= 5)) return w;
          const lw = w.toLowerCase();
          if (i > 0 && SMALL.has(lw)) return lw;
          return lw.replace(/(^|[-(/])([a-z])/g, (_, a, b) => a + b.toUpperCase());
        })
        .join(" ")
    : s;

/** Campaign money, collapsed by default: totals, where the money came from, and the largest committee donors. */
export function MoneyDetails({ f }: { f: Finance }) {
  const s = f.bySource;
  const parts = s
    ? [
        { label: "Individuals", n: s.individuals, cls: "bg-accent" },
        { label: "PACs & committees", n: s.committees, cls: "bg-spent" },
        { label: "Party", n: s.party, cls: "bg-ink-60" },
        { label: "Own money & loans", n: s.candidate + s.candidateLoans, cls: "bg-cash" },
      ].filter((p) => p.n > 0)
    : [];
  const sum = parts.reduce((a, p) => a + p.n, 0);
  return (
    <details className="group border border-card bg-paper-raised">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="font-sans text-[12px] font-bold uppercase tracking-[0.06em] text-ink">
          <span aria-hidden className="mr-1.5 inline-block transition-transform group-open:rotate-90">›</span>
          Campaign money
        </span>
        <span className="font-mono text-[12px] text-ink-60">
          {money(f.receipts)} raised
          {sum > 0 && ` · ${Math.round(((s?.individuals ?? 0) / sum) * 100)}% from individuals`} · FEC through {f.asOf}
        </span>
      </summary>
      <div className="grid gap-6 border-t border-hairline px-4 py-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-45">Totals this cycle</h3>
          <Meter label="Raised" value={f.receipts} max={f.receipts} cls="bg-accent" />
          <Meter label="Spent" value={f.disbursements} max={f.receipts} cls="bg-spent" />
          <Meter label="Cash on hand" value={f.cashOnHand} max={f.receipts} cls="bg-cash" />
          <p className="font-sans text-[11.5px] leading-snug text-ink-45">Bars share one scale (raised = full). Cash on hand can include money carried over from earlier cycles.</p>
          {parts.length > 0 && (
            <>
              <h3 className="mb-2 mt-4 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-45">Who gave</h3>
              <div className="flex h-3 overflow-hidden rounded-[2px] bg-canvas">
                {parts.map((p) => (
                  <i key={p.label} className={`block h-full ${p.cls}`} style={{ width: `${(p.n / sum) * 100}%` }} />
                ))}
              </div>
              <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-sans text-[12px] text-ink-60">
                {parts.map((p) => (
                  <li key={p.label}>
                    <span className={`mr-1.5 inline-block size-2 rounded-[1px] ${p.cls}`} />
                    {p.label} <b className="font-mono font-semibold text-ink">{money(p.n)}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-45">Largest committee contributions</h3>
          {f.topCommittees?.length ? (
            <ol className="flex flex-col divide-y divide-hairline font-sans text-[12.5px]">
              {f.topCommittees.map((t) => (
                <li key={t.url} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-ink-80 underline decoration-hairline underline-offset-2 hover:decoration-ink">
                      {titleCase(t.name)}
                    </a>{" "}
                    <span className="font-mono text-[10.5px] text-ink-45">{t.kind}</span>
                  </span>
                  <span className="flex-none font-mono font-semibold text-ink tabular-nums">{money(t.amount)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="font-sans text-[12.5px] text-ink-45">No direct contributions from PACs or other committees in the FEC&rsquo;s bulk data.</p>
          )}
          <p className="mt-2 font-sans text-[11.5px] leading-snug text-ink-45">
            Direct contributions only; outside spending is not included. Individual donors are itemized in the FEC&rsquo;s receipts.{" "}
            {f.receiptsUrl && (
              <a href={f.receiptsUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">
                All itemized receipts ↗
              </a>
            )}{" "}
            <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">
              FEC filing ↗
            </a>
          </p>
        </div>
      </div>
    </details>
  );
}
