/**
 * Data-source abstraction for The Full Record.
 *
 * The UI (server components and API routes) talks only to the DataSource
 * interface. The current implementation is a hybrid:
 *  - address lookup is LIVE (Census geocoder + NYC ArcGIS + public rosters),
 *    so any New York address resolves to real, current officeholders
 *  - vote records merge the hand-verified snapshot in data.ts with the
 *    chamber-wide roll calls ingested by scripts/ingest/ (src/server/snapshot/)
 *  - said-vs-did pairs come from the editorial pipeline (content/said-vs-did)
 */

import * as data from "./data";
import { lookupOfficials, resolveOfficialByDistrictKey } from "./live/lookup";
import { getSnapshots, snapshotAttendance, snapshotVotes } from "./live/snapshot";
import type {
  AttendanceEntry,
  Bill,
  Digest,
  DigestItem,
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
  | { ok: true; matchedAddress: string; groups: OfficialGroup[] }
  | { ok: false; reason: "no-match" | "outside-ny" | "lookup-failed" };

export interface DataSource {
  /** Resolve an address to the officials who represent it, grouped by level. */
  getOfficialsByAddress(address: string): Promise<OfficialsLookup>;
  getOfficial(id: string): Promise<Official | null>;
  /** Paginated with a true total — the UI always shows "Showing N of TOTAL". */
  getVotes(officialId: string, query?: VotesQuery): Promise<Paginated<VoteRecord>>;
  getSponsorships(officialId: string): Promise<Paginated<Sponsorship>>;
  getAttendance(officialId: string): Promise<Paginated<AttendanceEntry>>;
  getBill(id: string): Promise<Bill | null>;
  getSaidDidPairs(officialId: string): Promise<Paginated<SaidDidPair>>;
  getDigest(address: string): Promise<Digest>;
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

/**
 * Merge curated + ingested votes, newest first. A curated record wins over
 * its ingested twin (same bill, date, and kind — kind matters: a passage
 * vote and a same-day procedural motion on the same bill are distinct).
 */
async function mergedVotes(official: Official): Promise<VoteRecord[]> {
  const curated = data.votes.filter((v) => v.officialId === official.id);
  const key = (v: VoteRecord) => `${v.billNumber}|${v.date}|${v.kind}`;
  const seen = new Set(curated.map(key));
  const ingested = snapshotVotes(official.id, official.districtKey).filter(
    (v) => !seen.has(key(v))
  );
  return [...curated, ...ingested].sort((a, b) => b.date.localeCompare(a.date));
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
          officials: data.officials.filter((o) => o.level === level),
        })),
      };
    }
    return lookupOfficials(address);
  }

  async getOfficial(id: string): Promise<Official | null> {
    const curated = data.officials.find((o) => o.id === id);
    if (curated) return curated;
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

  async getBill(id: string): Promise<Bill | null> {
    return data.bills.find((b) => b.id === id) ?? null;
  }

  async getSaidDidPairs(officialId: string): Promise<Paginated<SaidDidPair>> {
    const { reviewedPairsFor } = await import("./editorial");
    const items = await reviewedPairsFor(officialId);
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  async getDigest(address: string): Promise<Digest> {
    const lookup = await this.getOfficialsByAddress(address);
    if (!lookup.ok) return data.digest;
    const officials = lookup.groups.flatMap((g) => g.officials);

    // The digest window is the 7 days ending today.
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const label = (d: Date) =>
      d.toLocaleString("en-US", { month: "short", day: "numeric" });

    const items: DigestItem[] = [];
    const quiet: string[] = [];
    for (const official of officials) {
      const recent = (await mergedVotes(official)).filter(
        (v) => v.date >= iso(start) && v.date <= iso(end)
      );
      if (!recent.length) {
        quiet.push(official.name);
        continue;
      }
      for (const v of recent.slice(0, 2)) {
        items.push({
          officialId: official.id,
          officialName: official.name,
          chamber: v.chamber,
          billNumber: v.billNumber,
          vote: v.vote,
          summary: v.aiSummary ?? v.title,
          outcome: v.outcome,
          dateLabel: v.dateLabel,
          sourceUrl: v.sourceUrl,
        });
      }
    }
    return {
      dateRangeLabel: `${label(start)} – ${label(end)}, ${end.getFullYear()}`,
      items,
      quietLine: quiet.length
        ? `No recorded floor votes are on file this week for your other ${quiet.length} representative${quiet.length === 1 ? "" : "s"}.`
        : "",
    };
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
        : Object.keys(s.memberKeys ?? {}).length;
      rollCalls += s.rollCalls.length;
    }
    return {
      trustLine: `Tracking ${officials} officials and ${rollCalls} recent recorded roll calls across city, state and federal government`,
      provenanceLine: data.siteStats.provenanceLine,
    };
  }
}

const dataSource: DataSource = new HybridDataSource();

export function getDataSource(): DataSource {
  return dataSource;
}
