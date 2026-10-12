/**
 * Ingested-snapshot loader.
 *
 * The one-off ingest scripts under scripts/ingest/ write one JSON file per
 * chamber into src/server/snapshot/. Each file holds a partial selection of
 * roll calls and the member positions resolved by that import. Federal files
 * cover every member of Congress (selected recent roll calls); state/city
 * selections are not complete.
 *
 * Member keys: bioguide id for Congress (house.json, ussenate.json);
 * district number string for NYC Council and Albany (council.json,
 * senate-ny.json, assembly-ny.json); Open States person id
 * ("ocd-person/{uuid}") for other states' legislatures
 * (state-{st}-{chamber}.json, keyBy "openstates").
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { partySplit, type PartySplit } from "../../lib/divisive";
import type { AttendanceEntry, VoteChoice, VoteRecord } from "../types";

export interface SnapshotRollCall {
  question?: string;
  rawVotes?: Record<string, string>;
  id: string;
  bill: string;
  title: string;
  summary?: string;
  summarySource?: "ai" | "official";
  kind: "substantive" | "procedural";
  outcome: string;
  date: string;
  dateLabel: string;
  sourceUrl: string;
  votes: Record<string, VoteChoice>;
}

export interface ChamberSnapshot {
  /** File stem under snapshot/, e.g. "house" or "state-tx-lower"; set by the loader */
  file?: string;
  generatedAt: string;
  chamber: string;
  sourceLabel: string;
  /** Total roll calls held this session, when the source publishes it */
  sessionRollCallTotal?: number;
  /** For Congress files: maps "{st}-{n|al}" (House) or "sen-{st}-{1|2}" (Senate) to bioguide */
  memberKeys?: Record<string, string>;
  /** Open States snapshots: votes are keyed by "ocd-person/{uuid}" for this state and chamber */
  keyBy?: "openstates";
  /** Open States snapshots: lowercase postal code, e.g. "tx" */
  jurisdiction?: string;
  /** Open States snapshots: which chamber of the jurisdiction this file covers */
  legislativeChamber?: "upper" | "lower" | "legislature";
  members?: Array<{
    key: string;
    name: string;
    party?: string | null;
    district?: string;
  }>;
  rollCalls: SnapshotRollCall[];
}

/** Roll call as stored on disk: verbose (votes) or compact (codes). */
type StoredRollCall = Omit<SnapshotRollCall, "votes"> & {
  votes?: Record<string, VoteChoice>;
  /** One char per snapshot.memberIndex entry: Y yes, N no, A absent, P present, "-" none */
  codes?: string;
};

/** On-disk form: a ChamberSnapshot, optionally with compact votes. */
export interface StoredSnapshot extends Omit<ChamberSnapshot, "rollCalls"> {
  /** Compact form: member keys, indexed by each roll call's `codes` string */
  memberIndex?: string[];
  rollCalls: StoredRollCall[];
}

const CODE_CHOICE: Record<string, VoteChoice> = {
  Y: "yes",
  N: "no",
  A: "absent",
  P: "present",
};

/** Expand compact `codes` into the verbose `votes` map (verbose files pass through). */
export function expandSnapshot(stored: StoredSnapshot): ChamberSnapshot {
  const { memberIndex, rollCalls, ...rest } = stored;
  return {
    ...rest,
    rollCalls: rollCalls.map(({ codes, votes, ...roll }) => {
      if (votes || !memberIndex || codes === undefined)
        return { ...roll, votes: votes ?? {} };
      const expanded: Record<string, VoteChoice> = {};
      for (let i = 0; i < memberIndex.length; i++) {
        const choice = CODE_CHOICE[codes[i]];
        if (choice) expanded[memberIndex[i]] = choice;
      }
      return { ...roll, votes: expanded };
    }),
  };
}

const SNAPSHOT_DIR = join(process.cwd(), "src/server/snapshot");

let loaded: ChamberSnapshot[] | null = null;

export function getSnapshots(): ChamberSnapshot[] {
  if (loaded) return loaded;
  const snapshots: ChamberSnapshot[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    // No snapshot directory yet — ingest hasn't been run.
  }
  for (const file of files) {
    try {
      const parsed = JSON.parse(
        readFileSync(join(SNAPSHOT_DIR, file), "utf8")
      ) as StoredSnapshot;
      if (Array.isArray(parsed.rollCalls)) {
        const snapshot = { ...expandSnapshot(parsed), file: file.replace(/\.json$/, "") };
        addSummaries(snapshot);
        snapshots.push(snapshot);
      }
    } catch (err) {
      console.error(`[snapshot] failed to load ${file}:`, err);
    }
  }
  loaded = snapshots;
  return snapshots;
}

/** Jurisdiction prefix used by vote-summaries.json keys ("<juris>:<bill>"). */
function summaryJuris(file: string): string | undefined {
  if (file.startsWith("state-")) return file.split("-")[1];
  return ({ house: "us", ussenate: "us", "senate-ny": "ny", "assembly-ny": "ny", council: "nyc" } as Record<string, string>)[file];
}
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * AI-written summaries (src/server/vote-summaries.json) for roll calls whose source has
 * none. Applied only when the bill title matches the one summarized, since bill numbers
 * repeat across sessions; an official summary always wins.
 */
let voteSummaries: Record<string, { title: string; summary: string; asOf?: string }> | null = null;
function addSummaries(snapshot: ChamberSnapshot) {
  if (!voteSummaries) {
    try {
      voteSummaries = JSON.parse(readFileSync(join(process.cwd(), "src/server/vote-summaries.json"), "utf8")).summaries ?? {};
    } catch {
      voteSummaries = {};
    }
  }
  const all = voteSummaries!;
  const juris = snapshot.file && summaryJuris(snapshot.file);
  if (!juris) return;
  for (const rc of snapshot.rollCalls) {
    if (rc.summary && rc.summary !== rc.title) continue;
    const s = all[`${juris}:${rc.bill}`];
    if (s && normTitle(s.title) === normTitle(rc.title)) {
      // Each summary was checked against one vote's version of the bill; on other votes say which.
      const other = s.asOf && s.asOf !== rc.date && !/^As /.test(s.summary);
      rc.summary = other ? `On the version voted ${longDate(s.asOf!)}: ${s.summary}` : s.summary;
      rc.summarySource = "ai";
    }
  }
}

let partyRoster: Record<string, Record<string, string>> | null = null;

/** Party code (D/R/I/...) of a member key in a snapshot, from parties.json; undefined if unknown. */
export function partyFor(
  snapshot: ChamberSnapshot,
  memberKey: string
): string | undefined {
  if (!partyRoster) {
    try {
      partyRoster = JSON.parse(
        readFileSync(join(process.cwd(), "src/server/parties.json"), "utf8")
      ).parties;
    } catch {
      partyRoster = {};
    }
  }
  return snapshot.file ? partyRoster?.[snapshot.file]?.[memberKey] : undefined;
}

const splits = new WeakMap<SnapshotRollCall, PartySplit>();

/** Party breakdown of one roll call (memoized). */
export function rollCallSplit(
  snapshot: ChamberSnapshot,
  rc: SnapshotRollCall
): PartySplit {
  let split = splits.get(rc);
  if (!split) {
    split = partySplit(rc.votes, (k) => partyFor(snapshot, k));
    splits.set(rc, split);
  }
  return split;
}

/** Map an official's districtKey to their member key within a snapshot. */
export function memberKeyFor(
  snapshot: ChamberSnapshot,
  districtKey: string
): string | null {
  const council = districtKey.match(/^nyc-council-(\d+)$/);
  if (council && snapshot.chamber === "NYC COUNCIL") return council[1];
  const sd = districtKey.match(/^ny-sd-(\d+)$/);
  if (sd && snapshot.chamber === "NY SENATE") return sd[1];
  const ad = districtKey.match(/^ny-ad-(\d+)$/);
  if (ad && snapshot.chamber === "NY ASSEMBLY") return ad[1];
  const house = districtKey.match(/^us-house-([a-z]{2})-(\d+|al)$/);
  if (house && snapshot.chamber === "U.S. HOUSE")
    return snapshot.memberKeys?.[`${house[1]}-${house[2]}`] ?? null;
  const sen = districtKey.match(/^us-sen-([a-z]{2})-([12])$/);
  if (sen && snapshot.chamber === "U.S. SENATE")
    return snapshot.memberKeys?.[`sen-${sen[1]}-${sen[2]}`] ?? null;
  const state = districtKey.match(/^([a-z]{2})-(upper|lower|legislature)-([0-9a-f-]{36})$/);
  if (
    state &&
    snapshot.keyBy === "openstates" &&
    snapshot.jurisdiction === state[1] &&
    snapshot.legislativeChamber === state[2]
  )
    return `ocd-person/${state[3]}`;
  return null;
}

/**
 * Party for a member as stated in an ingested snapshot (e.g. the Legistar
 * roster grid records each council member's party) — never guessed.
 */
export function snapshotMemberParty(districtKey: string): "D" | "R" | null {
  for (const snapshot of getSnapshots()) {
    const key = memberKeyFor(snapshot, districtKey);
    if (!key || !snapshot.members) continue;
    const member = snapshot.members.find((m) => m.key === key);
    if (member?.party === "D" || member?.party === "R") return member.party;
  }
  return null;
}

/** All snapshot-derived vote records for one official, newest first. */
export function snapshotVotes(
  officialId: string,
  districtKey: string
): VoteRecord[] {
  const records: VoteRecord[] = [];
  for (const snapshot of getSnapshots()) {
    const key = memberKeyFor(snapshot, districtKey);
    if (!key) continue;
    for (const rc of snapshot.rollCalls) {
      const vote = rc.votes[key];
      if (!vote) continue;
      records.push({
        id: `${officialId}--${rc.id}`,
        officialId,
        billNumber: rc.bill,
        chamber: snapshot.chamber,
        title: rc.title,
        question: rc.question,
        aiSummary: rc.summary,
        summarySource: rc.summarySource,
        vote,
        kind: rc.kind,
        unanimous: rollCallSplit(snapshot, rc).kind === "unanimous" || undefined,
        outcome: rc.outcome,
        date: rc.date,
        dateLabel: rc.dateLabel,
        sourceUrl: rc.sourceUrl,
        sourceLabel: snapshot.sourceLabel,
      });
    }
  }
  return records.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Attendance derived from the ingested roll calls: for each month, how many
 * of that chamber's ingested roll calls the member recorded a position in.
 * This measures participation in this sample, not physical attendance.
 */
export function snapshotAttendance(
  officialId: string,
  districtKey: string
): AttendanceEntry[] {
  const byMonth = new Map<
    string,
    { attended: number; total: number; sourceUrl: string }
  >();
  for (const snapshot of getSnapshots()) {
    const key = memberKeyFor(snapshot, districtKey);
    if (!key) continue;
    for (const rc of snapshot.rollCalls) {
      const vote = rc.votes[key];
      if (vote === undefined) continue;
      const month = rc.date.slice(0, 7);
      const bucket =
        byMonth.get(month) ?? { attended: 0, total: 0, sourceUrl: rc.sourceUrl };
      bucket.total += 1;
      if (vote !== "absent") bucket.attended += 1;
      byMonth.set(month, bucket);
    }
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, b]) => {
      const [y, m] = month.split("-");
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleString(
        "en-US",
        { month: "long", year: "numeric" }
      );
      return {
        id: `${officialId}-att-${month}`,
        officialId,
        period: label,
        attended: b.attended,
        total: b.total,
        sourceUrl: b.sourceUrl,
      };
    });
}
