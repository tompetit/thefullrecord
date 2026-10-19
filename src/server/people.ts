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
