/**
 * Live officeholder rosters, from keyless public sources:
 *  - U.S. Congress: the unitedstates/congress-legislators dataset
 *  - Other states + DC: Open States' CC0 people CSV (data.openstates.org)
 *  - NY Senate: nysenate.gov senators listing
 *  - NY Assembly: nyassembly.gov member listing
 *  - NYC Council: NYC Open Data current-members dataset
 *
 * Each fetch is cached in-process; these change rarely. A production build
 * would refresh on a schedule and persist alongside the vote snapshot.
 */

import { parseCsv } from "../../lib/csv";
import type { Party } from "../types";

export interface RosterEntry {
  name: string;
  party: Party | null;
  /**
   * Party as the source states it when it is not one of the three codes in
   * `Party` (e.g. "Independent"). Rendered neutrally; never coloured.
   */
  partyLabel?: string;
  /** district number as a plain string ("10", "26"); "" for statewide seats */
  district: string;
  url: string;
}

export interface CongressMember extends RosterEntry {
  bioguide: string;
  /** ISO date the current term ends */
  termEnd: string;
  /** Upper-case postal abbreviation */
  state: string;
  /** Non-voting delegate / resident commissioner (DC, PR, GU, VI, AS, MP) */
  delegate: boolean;
}

export interface CongressRoster {
  /** keyed "{st}-{district}" lowercase; at-large seats and delegates use "{st}-al" */
  house: Map<string, CongressMember>;
  /** keyed by lowercase postal abbreviation; senior senator first */
  senators: Map<string, CongressMember[]>;
}

export type StateChamber = "upper" | "lower" | "legislature";

export interface StateMember extends RosterEntry {
  /** Open States person uuid (the id without the "ocd-person/" prefix) */
  id: string;
  chamber: StateChamber;
  /** Open States' own district label, e.g. "Coos 5", "16A", "Ward 2", "At-Large" */
  districtLabel: string;
}

const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

const normalizeParty = (p: string | undefined): Party | null => {
  if (!p) return null;
  const first = p.trim().toUpperCase();
  if (first.startsWith("D")) return "D";
  if (first.startsWith("R")) return "R";
  if (first.startsWith("W")) return "WFP";
  return null;
};

const DELEGATE_STATES = new Set(["DC", "PR", "GU", "VI", "AS", "MP"]);

interface LegislatorJson {
  id: { bioguide: string };
  name: { official_full?: string; first: string; last: string };
  terms: Array<{
    type: "rep" | "sen";
    start: string;
    end: string;
    state: string;
    district?: number;
    party: string;
    url?: string;
  }>;
}

/** Pure transform of the congress-legislators "current" file. Exported for tests. */
export function buildCongressRoster(legislators: LegislatorJson[]): CongressRoster {
  const house = new Map<string, CongressMember>();
  const senators = new Map<string, Array<{ member: CongressMember; firstSenateStart: string }>>();
  for (const leg of legislators) {
    const term = leg.terms[leg.terms.length - 1];
    const party = normalizeParty(term.party);
    const member: CongressMember = {
      name: leg.name.official_full ?? `${leg.name.first} ${leg.name.last}`,
      party,
      ...(party === null && term.party ? { partyLabel: term.party } : {}),
      district: term.type === "rep" ? String(term.district ?? 0) : "",
      url: term.url ?? "https://www.congress.gov/members",
      bioguide: leg.id.bioguide,
      termEnd: term.end,
      state: term.state,
      delegate: term.type === "rep" && DELEGATE_STATES.has(term.state),
    };
    const st = term.state.toLowerCase();
    if (term.type === "rep") {
      const n = term.district ? String(term.district) : "al";
      member.district = n;
      house.set(`${st}-${n}`, member);
    } else {
      const firstSenateStart =
        leg.terms.find((t) => t.type === "sen")?.start ?? term.start;
      const list = senators.get(st) ?? [];
      list.push({ member, firstSenateStart });
      senators.set(st, list);
    }
  }
  const ordered = new Map<string, CongressMember[]>();
  for (const [st, list] of senators)
    ordered.set(
      st,
      list
        .sort(
          (a, b) =>
            a.firstSenateStart.localeCompare(b.firstSenateStart) ||
            a.member.name.localeCompare(b.member.name)
        )
        .map((x) => x.member)
    );
  return { house, senators: ordered };
}

/** Every U.S. Representative, delegate and Senator, from congress-legislators. */
export function getCongressRoster(): Promise<CongressRoster> {
  return cached("congress", async () => {
    const raw = await fetchText(
      "https://unitedstates.github.io/congress-legislators/legislators-current.json"
    );
    const roster = buildCongressRoster(JSON.parse(raw) as LegislatorJson[]);
    if (roster.house.size < 400) throw new Error(`Congress roster parse too small: ${roster.house.size}`);
    return roster;
  });
}

const OPEN_STATES_PARTY: Record<string, Party> = { democratic: "D", republican: "R" };

/** Pure transform of an Open States people CSV. Exported for tests. */
export function parseStateRoster(csv: string, st: string): StateMember[] {
  const rows = parseCsv(csv);
  if (rows.length < 5) throw new Error(`Open States roster for ${st} parse too small: ${rows.length}`);
  const members: StateMember[] = [];
  for (const row of rows) {
    const chamber = row.current_chamber;
    if (chamber !== "upper" && chamber !== "lower" && chamber !== "legislature") continue;
    if (!row.id || !row.name) continue;
    const partyName = (row.current_party ?? "").trim();
    const party = OPEN_STATES_PARTY[partyName.toLowerCase()] ?? null;
    const links = (row.links ?? "").split(";").map((u) => u.trim()).filter(Boolean);
    const sources = (row.sources ?? "").split(";").map((u) => u.trim()).filter(Boolean);
    // `sources` often lead with Ballotpedia/Wikipedia; those are not the member's own page.
    const official = sources.find((u) => !/ballotpedia|wikipedia|votesmart|linkedin/i.test(u));
    members.push({
      id: row.id.replace(/^ocd-person\//, ""),
      name: row.name.trim(),
      party,
      ...(party === null && partyName ? { partyLabel: partyName } : {}),
      chamber,
      districtLabel: row.current_district.trim(),
      district: row.current_district.trim(),
      url: links[0] ?? official ?? `https://openstates.org/${st.toLowerCase()}/legislators/`,
    });
  }
  return members;
}

/**
 * Current state legislators for one state/DC/PR from Open States' keyless
 * CC0 people CSV. Not used for New York (see the NY rosters below, which
 * power the curated vote matching).
 */
export function getStateLegislatureRoster(st: string): Promise<StateMember[]> {
  const code = st.toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return Promise.reject(new Error(`bad state: ${st}`));
  return cached(`openstates-${code}`, async () =>
    parseStateRoster(await fetchText(`https://data.openstates.org/people/current/${code}.csv`), code)
  );
}

/** NY State Senate — all 63 districts, from nysenate.gov. */
export function getStateSenateRoster(): Promise<Map<string, RosterEntry>> {
  return cached("nysenate", async () => {
    const html = await fetchText("https://www.nysenate.gov/senators-committees");
    const roster = new Map<string, RosterEntry>();
    // Block shape: <a href=".../senators/slug"> … nys-senator--name">NAME</h2>
    //   … nys-senator--party"> (D, WF) </span> 26th District
    const re =
      /href="(?:https:\/\/www\.nysenate\.gov)?(\/senators\/[a-z0-9-]+)"[\s\S]*?nys-senator--name">([^<]+)<[\s\S]*?nys-senator--party">\s*\(([^)]*)\)\s*<\/span>\s*(\d+)(?:st|nd|rd|th) District/g;
    for (const m of html.matchAll(re)) {
      const [, path, name, party, district] = m;
      roster.set(district, {
        name: name.trim(),
        party: normalizeParty(party),
        district,
        url: `https://www.nysenate.gov${path}`,
      });
    }
    if (roster.size < 50) throw new Error(`NY Senate roster parse too small: ${roster.size}`);
    return roster;
  });
}

/** NY State Assembly — all 150 districts, from nyassembly.gov. */
export function getAssemblyRoster(): Promise<Map<string, RosterEntry>> {
  return cached("nyassembly", async () => {
    const html = await fetchText("https://nyassembly.gov/mem/");
    const roster = new Map<string, RosterEntry>();
    // Block shape: mem-name"><a … href="/mem/Slug"> NAME <span>District 52</span>
    const re =
      /mem-name"><a[^>]*href="(\/mem\/[^"]+)">\s*([^<]+?)\s*<span>District (\d+)<\/span>/g;
    for (const m of html.matchAll(re)) {
      const [, path, name, district] = m;
      roster.set(district, {
        name: name.trim(),
        party: null, // the listing page does not show party; filled by OpenLegislation ingest
        district,
        url: `https://nyassembly.gov${path}`,
      });
    }
    if (roster.size < 100) throw new Error(`Assembly roster parse too small: ${roster.size}`);
    return roster;
  });
}

/** NYC Council — current members from NYC Open Data. */
export function getCouncilRoster(): Promise<Map<string, RosterEntry>> {
  return cached("council", async () => {
    const raw = await fetchText(
      "https://data.cityofnewyork.us/resource/uvw5-9znb.json?$where=term_end>'2026-07-01T00:00:00'&$limit=100"
    );
    const rows = JSON.parse(raw) as Array<{ name: string; district: string }>;
    const roster = new Map<string, RosterEntry>();
    for (const row of rows) {
      roster.set(row.district, {
        name: row.name.trim(),
        party: null, // not in the dataset; filled from the council snapshot when known
        district: row.district,
        url: `https://council.nyc.gov/district-${row.district}/`,
      });
    }
    if (roster.size < 45) throw new Error(`Council roster parse too small: ${roster.size}`);
    return roster;
  });
}
