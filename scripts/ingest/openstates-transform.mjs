/**
 * Pure transform: Open States API v3 bills (with include=votes) -> per-chamber
 * ChamberSnapshot files. No I/O, so it is unit-tested against a fixture.
 */
import { chamberName, stateName } from "../../src/lib/usStates.ts";
import { isOfficialStateSource } from "./shared.mjs";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Open States option -> site vote. */
export function mapOpenStatesVote(option) {
  switch (String(option).toLowerCase()) {
    case "yes": return "yes";
    case "no": return "no";
    case "absent": case "not voting": case "excused": return "absent";
    case "abstain": case "other": return "present";
    default: return null;
  }
}

const PROCEDURAL = /journal|previous question|adjourn|recess|\btable\b|tabled|recommit|\brefer\b|referred|call of the (house|senate)|quorum|point of order|reconsider|rules? suspension|suspend the rules|\bcalendar\b/i;

function classify(vote) {
  const classes = vote.motion_classification ?? [];
  if (classes.some((c) => /passage/.test(c))) return "substantive";
  return PROCEDURAL.test(vote.motion_text ?? "") ? "procedural" : "substantive";
}

export function snapshotChamberName(st, chamber) {
  const S = st.toUpperCase();
  if (S === "DC") return "DC COUNCIL";
  if (chamber === "legislature") return `${S} LEGISLATURE`;
  return `${S} ${chamberName(S, chamber).replace(/^State /, "").toUpperCase()}`;
}

function dateParts(startDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate ?? "");
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  if (new Date(iso).toISOString().slice(0, 10) !== iso) return null;
  return [iso, `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`];
}

/**
 * @param bills  API v3 `results` array
 * @param st     lowercase postal code
 * @param now    ISO date used to reject future-dated events
 * @param maxVotes keep only this many most-recent vote events per chamber
 * @returns { snapshots: Map<chamber, snapshot>, skipped: {reason: count} }
 */
export function transformBills(bills, st, now = new Date().toISOString(), maxVotes = 300) {
  const rollsByChamber = new Map();
  const skipped = {};
  const skip = (reason) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  for (const bill of bills) {
    for (const vote of bill.votes ?? []) {
      const chamber = vote.organization?.classification;
      if (!["upper", "lower", "legislature"].includes(chamber)) { skip("not-floor-vote"); continue; }
      const when = dateParts(vote.start_date);
      if (!when || when[0] > now.slice(0, 10)) { skip("bad-date"); continue; }
      // Some legislatures (e.g. CA leginfo) are listed with http:// URLs; their sites serve https, so upgrade before the https-only official-source check.
      const toHttps = (u) => (typeof u === "string" ? u.replace(/^http:\/\//i, "https://") : u);
      const sourceUrl = [vote.sources?.[0]?.url, bill.sources?.[0]?.url].map(toHttps).find((u) => u && isOfficialStateSource(u));
      if (!sourceUrl) { skip("no-official-source"); continue; }
      // Committee votes are sometimes filed under the parent chamber; they are not floor votes.
      if ([vote, bill].some((x) => (x.sources ?? []).some((src) => /committee/i.test(src.url ?? "")))) { skip("committee-vote"); continue; }
      const votes = {};
      for (const v of vote.votes ?? []) {
        const id = v.voter?.id;
        const mapped = mapOpenStatesVote(v.option);
        if (!id || !mapped) continue;
        votes[id] = mapped;
      }
      if (!Object.keys(votes).length) { skip("no-identified-voters"); continue; }
      // Open States sometimes lists only some voters; a partial list would misstate who voted, so require
      // that the identified voters cover at least 97% of the vote's own tally.
      const tallied = (vote.counts ?? []).reduce((n, c) => n + (Number(c.value) || 0), 0);
      if (tallied > 0 && Object.keys(votes).length < 0.97 * tallied) { skip("incomplete-voter-list"); continue; }
      const tally = (option) => {
        const fromCounts = (vote.counts ?? []).find((c) => c.option === option)?.value;
        return fromCounts ?? (vote.votes ?? []).filter((x) => x.option === option).length;
      };
      const result = String(vote.result ?? "").toLowerCase();
      const word = result === "pass" ? "Passed" : result === "fail" ? "Failed" : "Result recorded";
      const roll = {
        id: `os-${st}-${String(vote.id).replace(/^ocd-vote\//, "")}`,
        bill: bill.identifier,
        title: bill.title,
        question: vote.motion_text || undefined,
        kind: classify(vote),
        outcome: `${word} ${tally("yes")}–${tally("no")}`,
        date: when[0],
        dateLabel: when[1],
        sourceUrl,
        votes,
      };
      if (!roll.bill || !roll.title) { skip("missing-bill-metadata"); continue; }
      const list = rollsByChamber.get(chamber) ?? [];
      if (!list.some((r) => r.id === roll.id)) list.push(roll);
      rollsByChamber.set(chamber, list);
    }
  }
  const snapshots = new Map();
  for (const [chamber, rollCalls] of rollsByChamber) {
    rollCalls.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    rollCalls.length = Math.min(rollCalls.length, maxVotes);
    const label = snapshotChamberName(st, chamber);
    snapshots.set(chamber, {
      generatedAt: now,
      chamber: label,
      sourceLabel: `Roll call · ${stateName(st)} ${label.slice(3).toLowerCase().replace(/\b(?!of\b)\w/g, (c) => c.toUpperCase())} (via Open States)`,
      keyBy: "openstates",
      jurisdiction: st,
      legislativeChamber: chamber,
      rollCalls,
    });
  }
  return { snapshots, skipped };
}
