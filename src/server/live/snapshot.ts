/**
 * Ingested-snapshot loader.
 *
 * The one-off ingest scripts under scripts/ingest/ write one JSON file per
 * chamber into src/server/snapshot/. Each file holds a partial selection of
 * roll calls and the member positions resolved by that import. Federal files
 * include New York members only; state/city selections are not complete.
 *
 * Member keys: bioguide id for Congress (house.json, ussenate.json);
 * district number string for NYC Council and Albany (council.json,
 * senate-ny.json, assembly-ny.json).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
  generatedAt: string;
  chamber: string;
  sourceLabel: string;
  /** Total roll calls held this session, when the source publishes it */
  sessionRollCallTotal?: number;
  /** For Congress files: maps district ("10") or seat ("sen-1") to bioguide */
  memberKeys?: Record<string, string>;
  members?: Array<{
    key: string;
    name: string;
    party?: string | null;
    district?: string;
  }>;
  rollCalls: SnapshotRollCall[];
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
      ) as ChamberSnapshot;
      if (Array.isArray(parsed.rollCalls)) snapshots.push(parsed);
    } catch (err) {
      console.error(`[snapshot] failed to load ${file}:`, err);
    }
  }
  loaded = snapshots;
  return snapshots;
}

/** Map an official's districtKey to their member key within a snapshot. */
function memberKeyFor(
  snapshot: ChamberSnapshot,
  districtKey: string
): string | null {
  const council = districtKey.match(/^nyc-council-(\d+)$/);
  if (council && snapshot.chamber === "NYC COUNCIL") return council[1];
  const sd = districtKey.match(/^ny-sd-(\d+)$/);
  if (sd && snapshot.chamber === "NY SENATE") return sd[1];
  const ad = districtKey.match(/^ny-ad-(\d+)$/);
  if (ad && snapshot.chamber === "NY ASSEMBLY") return ad[1];
  const house = districtKey.match(/^us-house-ny-(\d+)$/);
  if (house && snapshot.chamber === "U.S. HOUSE")
    return snapshot.memberKeys?.[house[1]] ?? null;
  const sen = districtKey.match(/^us-sen-ny-(\d)$/);
  if (sen && snapshot.chamber === "U.S. SENATE")
    return snapshot.memberKeys?.[`sen-${sen[1]}`] ?? null;
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
