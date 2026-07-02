/**
 * Data-source abstraction for The Full Record.
 *
 * The UI (server components and API routes) talks only to the DataSource
 * interface. `InMemoryDataSource` serves the researched snapshot in data.ts;
 * going live means implementing this interface against a real database /
 * the upstream APIs and returning it from `getDataSource()`.
 */

import * as data from "./data";
import type {
  AttendanceEntry,
  Bill,
  Digest,
  IssueReport,
  Official,
  OfficialGroup,
  Paginated,
  SaidDidPair,
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

export interface DataSource {
  /** Resolve an address to the officials who represent it, grouped by level. */
  getOfficialsByAddress(address: string): Promise<OfficialGroup[]>;
  getOfficial(id: string): Promise<Official | null>;
  /** Paginated with a true total — the UI always shows "Showing N of TOTAL". */
  getVotes(officialId: string, query?: VotesQuery): Promise<Paginated<VoteRecord>>;
  getSponsorships(officialId: string): Promise<Paginated<Sponsorship>>;
  getAttendance(officialId: string): Promise<Paginated<AttendanceEntry>>;
  getBill(id: string): Promise<Bill | null>;
  getSaidDidPairs(officialId: string): Promise<Paginated<SaidDidPair>>;
  getDigest(address: string): Promise<Digest>;
  getSiteStats(): Promise<SiteStats>;
  submitIssueReport(report: IssueReport): Promise<{ ok: true }>;
}

const GROUP_ORDER: Array<{ level: OfficialGroup["level"]; label: string }> = [
  { level: "city", label: "CITY — NYC COUNCIL" },
  { level: "state", label: "STATE — ALBANY" },
  { level: "federal", label: "FEDERAL — U.S. CONGRESS" },
];

class InMemoryDataSource implements DataSource {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getOfficialsByAddress(address: string): Promise<OfficialGroup[]> {
    // A real implementation geocodes the address and resolves districts.
    // This snapshot returns the officials for the researched sample address.
    return GROUP_ORDER.map(({ level, label }) => ({
      level,
      label,
      officials: data.officials.filter((o) => o.level === level),
    }));
  }

  async getOfficial(id: string): Promise<Official | null> {
    return data.officials.find((o) => o.id === id) ?? null;
  }

  async getVotes(
    officialId: string,
    query: VotesQuery = {}
  ): Promise<Paginated<VoteRecord>> {
    const { filter = "all", page = 1, pageSize = 10 } = query;
    const all = data.votes
      .filter((v) => v.officialId === officialId)
      .filter((v) => filter === "all" || v.kind === filter)
      .sort((a, b) => b.date.localeCompare(a.date));
    // Fall back to the count on file when the chamber total is unknown so the
    // "Showing N of TOTAL" affordance renders honestly against the design.
    const official = data.officials.find((o) => o.id === officialId);
    const total =
      filter === "all" && official?.stats.votesThisSession != null
        ? official.stats.votesThisSession
        : all.length;
    const start = (page - 1) * pageSize;
    return {
      items: all.slice(start, start + pageSize),
      total: Math.max(total, all.length),
      page,
      pageSize,
    };
  }

  async getSponsorships(officialId: string): Promise<Paginated<Sponsorship>> {
    const items = data.sponsorships.filter((s) => s.officialId === officialId);
    const official = data.officials.find((o) => o.id === officialId);
    return {
      items,
      total: Math.max(official?.stats.billsSponsored ?? 0, items.length),
      page: 1,
      pageSize: items.length,
    };
  }

  async getAttendance(officialId: string): Promise<Paginated<AttendanceEntry>> {
    const items = data.attendance.filter((a) => a.officialId === officialId);
    return { items, total: items.length, page: 1, pageSize: items.length };
  }

  async getBill(id: string): Promise<Bill | null> {
    return data.bills.find((b) => b.id === id) ?? null;
  }

  async getSaidDidPairs(officialId: string): Promise<Paginated<SaidDidPair>> {
    const items = data.saidDidPairs.filter((p) => p.officialId === officialId);
    return {
      items,
      total: items.length ? data.saidDidTotal : 0,
      page: 1,
      pageSize: items.length,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getDigest(address: string): Promise<Digest> {
    return data.digest;
  }

  async getSiteStats(): Promise<SiteStats> {
    return data.siteStats;
  }

  async submitIssueReport(report: IssueReport): Promise<{ ok: true }> {
    // Snapshot mode: log only. A real implementation persists the report.
    console.log("[report-an-issue]", JSON.stringify(report));
    return { ok: true };
  }
}

const dataSource: DataSource = new InMemoryDataSource();

export function getDataSource(): DataSource {
  return dataSource;
}
