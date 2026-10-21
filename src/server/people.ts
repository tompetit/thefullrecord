/**
 * The people directory index (src/server/people.json, built by `npm run people:index`):
 * one row per current officeholder and 2026 candidate, one stable slug each.
 * Loaded once per process.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { officials as curatedOfficials } from "./data";

export interface PersonOffice {
  kind: "official";
  /** Resolvable by DataSource.getOfficial (a districtKey) */
  officialId: string;
  role: string;
}

export interface Candidacy {
  raceId?: string;
  candidateId?: string;
  /** Slate seat key, e.g. "tx-lower-49" */
  seatKey?: string;
  office: string;
  district?: string;
  parties: string[];
}

export interface Person {
  slug: string;
  key: string;
  alt?: string[];
  name: string;
  /** Party code (D/R/WFP...) or the label the roster states */
  party?: string;
  /** Upper-case postal code */
  state: string;
  offices?: PersonOffice[];
  candidacies?: Candidacy[];
  photo?: { url: string; source: string };
}

interface Indexes {
  all: Person[];
  bySlug: Map<string, Person>;
  byOfficialId: Map<string, Person>;
  byCandidacy: Map<string, Person>;
  bySeat: Map<string, Person[]>;
  byRace: Map<string, Person[]>;
}

let loaded: Indexes | null = null;

function load(): Indexes {
  if (loaded) return loaded;
  const all = JSON.parse(readFileSync(join(process.cwd(), "src/server/people.json"), "utf8")) as Person[];
  const idx: Indexes = { all, bySlug: new Map(), byOfficialId: new Map(), byCandidacy: new Map(), bySeat: new Map(), byRace: new Map() };
  const push = (m: Map<string, Person[]>, k: string, p: Person) => m.set(k, [...(m.get(k) ?? []), p]);
  for (const p of all) {
    idx.bySlug.set(p.slug, p);
    for (const o of p.offices ?? []) idx.byOfficialId.set(o.officialId, p);
    for (const c of p.candidacies ?? []) {
      if (c.raceId) {
        idx.byCandidacy.set(`${c.raceId}/${c.candidateId}`, p);
        push(idx.byRace, c.raceId, p);
      }
      if (c.seatKey) push(idx.bySeat, c.seatKey, p);
    }
  }
  // Curated profiles are also addressed by their own ids ("lincoln-restler").
  for (const o of curatedOfficials) {
    const p = idx.byOfficialId.get(o.districtKey);
    if (p) idx.byOfficialId.set(o.id, p);
  }
  return (loaded = idx);
}

export const getPeople = () => load().all;
export const getPerson = (slug: string) => load().bySlug.get(slug) ?? null;
export const personForOfficial = (officialId: string) => load().byOfficialId.get(officialId) ?? null;
export const personForCandidate = (raceId: string, candidateId: string) => load().byCandidacy.get(`${raceId}/${candidateId}`) ?? null;
export const peopleInRace = (raceId: string) => load().byRace.get(raceId) ?? [];
export const peopleInSeat = (seatKey: string) => load().bySeat.get(seatKey) ?? [];

/** Permanent profile URL for an official id, or the legacy /official/<id> page when unmapped (vacant seats, stubs). */
export function personHrefForOfficial(officialId: string): string {
  const p = personForOfficial(officialId);
  return p ? `/people/${p.slug}` : `/official/${officialId}`;
}

export const PEOPLE_PAGE_SIZE = 60;
export const PEOPLE_LEVELS = [
  ["congress", "Congress"],
  ["governor", "Governor"],
  ["legislature", "State legislature"],
  ["council", "NYC Council"],
] as const;
export type PeopleLevel = (typeof PEOPLE_LEVELS)[number][0];
export interface PeopleFilters {
  q?: string;
  state?: string;
  kind?: "office" | "ballot" | "both";
  level?: PeopleLevel;
  page?: number;
}

interface Row {
  p: Person;
  hay: string;
  office: boolean;
  ballot: boolean;
  levels: Set<PeopleLevel>;
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
let rows: Row[] | null = null;

function searchRows(): Row[] {
  if (rows) return rows;
  return (rows = [...getPeople()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug))
    .map((p) => {
      const levels = new Set<PeopleLevel>();
      for (const o of p.offices ?? []) levels.add(/^us-/.test(o.officialId) ? "congress" : /^nyc-council-/.test(o.officialId) ? "council" : "legislature");
      for (const c of p.candidacies ?? []) {
        if (/^U\.S\./.test(c.office)) levels.add("congress");
        else if (c.office === "Governor") levels.add("governor");
        else if (c.seatKey || /^State /.test(c.office)) levels.add("legislature");
      }
      return { p, hay: fold(p.name), office: !!p.offices?.length, ballot: !!p.candidacies?.length, levels };
    }));
}

/** Postal codes present in the index, sorted. */
export const peopleStates = () => [...new Set(getPeople().map((p) => p.state))].sort();

/** Filtered, alphabetical, paginated. Name terms must all appear in the name (accent- and case-insensitive). */
export function searchPeople(f: PeopleFilters) {
  const terms = fold(f.q ?? "").split(/[^a-z0-9]+/).filter(Boolean);
  const hits = searchRows().filter(
    (r) =>
      (!f.state || r.p.state === f.state) &&
      (!f.level || r.levels.has(f.level)) &&
      (!f.kind || (f.kind === "office" ? r.office : f.kind === "ballot" ? r.ballot : r.office && r.ballot)) &&
      terms.every((t) => r.hay.includes(t))
  );
  const pages = Math.max(1, Math.ceil(hits.length / PEOPLE_PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page ?? 1), pages);
  return { items: hits.slice((page - 1) * PEOPLE_PAGE_SIZE, page * PEOPLE_PAGE_SIZE).map((r) => r.p), total: hits.length, page, pages };
}
