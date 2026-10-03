/**
 * Data-source abstraction for The Full Record.
 *
 * The UI (server components and API routes) talks only to the DataSource
 * interface. The current implementation is a hybrid:
 *  - address lookup is LIVE (Census geocoder + TIGERweb + NYC ArcGIS +
 *    public rosters), so any U.S. address resolves to real, current
 *    officeholders: Congress and state legislators everywhere, NYC Council
 *    in NYC, and the D.C. Council in D.C.
 *  - vote records merge the hand-verified snapshot in data.ts with the
 *    chamber-wide roll calls ingested by scripts/ingest/ (src/server/snapshot/):
 *    every member of Congress, New York's Albany and NYC bodies, and other
 *    states' legislatures only where an Open States snapshot exists
 *  - said-vs-did pairs come from the editorial pipeline (content/said-vs-did)
 */

import * as data from "./data";
import { lookupOfficials, resolveOfficialByDistrictKey } from "./live/lookup";
import { getSnapshots, snapshotAttendance, snapshotVotes } from "./live/snapshot";
import type {
  AttendanceEntry,
  LookupContext,
  Official,
  OfficialGroup,
  Paginated,
  SaidDidPair,
  SeatElection,
  SeatNotOnBallot,
  SiteStats,
  Sponsorship,
  VoteKind,
  VoteRecord,
} from "./types";

export interface VotesQuery {
  filter?: "all" | VoteKind;
  page?: number;
  pageSize?: number;
}

export type OfficialsLookup =
  | { ok: true; matchedAddress: string; groups: OfficialGroup[]; context?: LookupContext }
  | { ok: false; reason: "no-match" | "lookup-failed" };

export interface DataSource {
  /** Resolve an address to the officials who represent it, grouped by level. */
  getOfficialsByAddress(address: string): Promise<OfficialsLookup>;
  getOfficial(id: string): Promise<Official | null>;
  /** Paginated with a true total — the UI always shows "Showing N of TOTAL". */
  getVotes(officialId: string, query?: VotesQuery): Promise<Paginated<VoteRecord>>;
  getSponsorships(officialId: string): Promise<Paginated<Sponsorship>>;
  getAttendance(officialId: string): Promise<Paginated<AttendanceEntry>>;
  getSaidDidPairs(officialId: string): Promise<Paginated<SaidDidPair>>;
  /** 2026 slate for a seat, or when it's next on the ballot. */
  getSeatElection(
    districtKey: string
  ): Promise<SeatElection | SeatNotOnBallot | null>;
  getSiteStats(): Promise<SiteStats>;
}

const GROUP_ORDER: Array<{ level: OfficialGroup["level"]; label: string }> = [
  { level: "city", label: "CITY — NYC COUNCIL" },
  { level: "state", label: "STATE — ALBANY" },
  { level: "federal", label: "FEDERAL — U.S. CONGRESS" },
];

/** Prefer sourced snapshots; retain separate motions on the same bill and day. */
async function mergedVotes(official: Official): Promise<VoteRecord[]> {
  const ingested = snapshotVotes(official.id, official.districtKey);
  const key = (v: VoteRecord) => {
    // Congressional source URLs identify the actual roll call, unlike bill pages.
    if (/clerk\.house\.gov\/Votes\/|senate\.gov\/legislative\/LIS\/roll_call_votes\//.test(v.sourceUrl)) {
      return v.sourceUrl.replace(/\/$/, "");
    }
    return `${v.billNumber}|${v.date}|${v.kind}`;
  };
  const seen = new Set(ingested.map(key));
  const curated = data.votes.filter((v) => v.officialId === official.id && !seen.has(key(v)));
  return [...ingested, ...curated].sort((a, b) => b.date.localeCompare(a.date));
}

/** Refresh activity text without pretending partial counts are session totals. */
function withRecordedActivity(official: Official): Official {
  const latest = snapshotVotes(official.id, official.districtKey)[0];
  if (!latest) return official;
  const action = latest.vote === "absent" ? "not voting on" : latest.vote === "present" ? "recorded present on" : `voted ${latest.vote} on`;
  return {
    ...official,
    teaser: { text: `Latest on file: ${action} ${latest.billNumber} · ${latest.dateLabel}`, vote: latest.vote },
  };
}

class HybridDataSource implements DataSource {
  async getOfficialsByAddress(address: string): Promise<OfficialsLookup> {
    if (!address.trim()) {
      // No address given: fall back to the researched sample address.
      return {
        ok: true,
        matchedAddress: data.SAMPLE_ADDRESS,
        groups: GROUP_ORDER.map(({ level, label }) => ({
          level,
          label,
          officials: data.officials.filter((o) => o.level === level).map(withRecordedActivity),
        })),
      };
    }
    const result = await lookupOfficials(address);
    return result.ok ? { ...result, groups: result.groups.map(group => ({ ...group, officials: group.officials.map(withRecordedActivity) })) } : result;
  }

  async getOfficial(id: string): Promise<Official | null> {
    const curated = data.officials.find((o) => o.id === id);
    if (curated) return withRecordedActivity(curated);
    // Stub ids are districtKeys (e.g. "nyc-council-35") — resolve via rosters.
    return resolveOfficialByDistrictKey(id);
  }

  async getVotes(
    officialId: string,
    query: VotesQuery = {}
  ): Promise<Paginated<VoteRecord>> {
    const { filter = "all", page = 1, pageSize = 10 } = query;
    const official = await this.getOfficial(officialId);
    if (!official) return { items: [], total: 0, page, pageSize };
    const all = (await mergedVotes(official)).filter(
      (v) => filter === "all" || v.kind === filter
    );
    const start = (page - 1) * pageSize;
    return {
      items: all.slice(start, start + pageSize),
      total: all.length,
      page,
      pageSize,
    };
  }

  async getSponsorships(officialId: string): Promise<Paginated<Sponsorship>> {
    const items = data.sponsorships.filter((s) => s.officialId === officialId);
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  async getAttendance(officialId: string): Promise<Paginated<AttendanceEntry>> {
    const official = await this.getOfficial(officialId);
    const items = official
      ? snapshotAttendance(official.id, official.districtKey)
      : [];
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  async getSaidDidPairs(officialId: string): Promise<Paginated<SaidDidPair>> {
    const { reviewedPairsFor } = await import("./editorial");
    const items = await reviewedPairsFor(officialId);
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  async getSeatElection(districtKey: string) {
    const { electionForSeat } = await import("./live/elections");
    return electionForSeat(districtKey);
  }

  async getSiteStats(): Promise<SiteStats> {
    // Completeness is visible: the trust line states what we actually track,
    // computed from the ingested snapshots rather than hardcoded.
    const snapshots = getSnapshots();
    if (!snapshots.length) return data.siteStats;
    let officials = 0;
    let rollCalls = 0;
    for (const s of snapshots) {
      // Count seats, not member records — mid-session replacements can leave
      // two records for one district.
      officials += s.members
        ? new Set(s.members.map((m) => m.district ?? m.key)).size
        : s.keyBy === "openstates"
          ? new Set(s.rollCalls.flatMap((r) => Object.keys(r.votes))).size
          : Object.keys(s.memberKeys ?? {}).length;
      rollCalls += s.rollCalls.length;
    }
    return {
      trustLine: `Tracking ${officials} officials and ${rollCalls} recorded roll calls in a partial dataset across city, state and federal government`,
      provenanceLine: data.siteStats.provenanceLine,
    };
  }
}

const dataSource: DataSource = new HybridDataSource();

export function getDataSource(): DataSource {
  return dataSource;
}
