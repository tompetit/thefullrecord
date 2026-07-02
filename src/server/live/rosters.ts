/**
 * Live officeholder rosters, from keyless public sources:
 *  - U.S. Congress: the unitedstates/congress-legislators dataset
 *  - NY Senate: nysenate.gov senators listing
 *  - NY Assembly: nyassembly.gov member listing
 *  - NYC Council: NYC Open Data current-members dataset
 *
 * Each fetch is cached in-process; these change rarely. A production build
 * would refresh on a schedule and persist alongside the vote snapshot.
 */

import type { Party } from "../types";

export interface RosterEntry {
  name: string;
  party: Party | null;
  /** district number as a plain string ("10", "26"); "" for statewide seats */
  district: string;
  url: string;
}

export interface CongressRoster {
  /** keyed by district number */
  houseNY: Map<string, RosterEntry>;
  senatorsNY: RosterEntry[];
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

/** U.S. House (NY delegation) + both NY U.S. Senators. */
export function getCongressRoster(): Promise<CongressRoster> {
  return cached("congress", async () => {
    const raw = await fetchText(
      "https://unitedstates.github.io/congress-legislators/legislators-current.json"
    );
    const legislators = JSON.parse(raw) as Array<{
      name: { official_full?: string; first: string; last: string };
      terms: Array<{
        type: "rep" | "sen";
        state: string;
        district?: number;
        party: string;
        url?: string;
        end: string;
      }>;
    }>;
    const houseNY = new Map<string, RosterEntry>();
    const senators: Array<{ entry: RosterEntry; firstSenTerm: string }> = [];
    for (const leg of legislators) {
      const term = leg.terms[leg.terms.length - 1];
      if (term.state !== "NY") continue;
      const entry: RosterEntry = {
        name: leg.name.official_full ?? `${leg.name.first} ${leg.name.last}`,
        party: normalizeParty(term.party),
        district: term.type === "rep" ? String(term.district ?? "") : "",
        url: term.url ?? "https://www.congress.gov/members",
      };
      if (term.type === "rep") houseNY.set(entry.district, entry);
      else
        senators.push({
          entry,
          firstSenTerm:
            leg.terms.find((t) => t.type === "sen" && t.state === "NY")?.end ??
            term.end,
        });
    }
    // Deterministic order: senior senator first (us-sen-ny-1), junior second.
    const senatorsNY = senators
      .sort((a, b) => a.firstSenTerm.localeCompare(b.firstSenTerm))
      .map((s) => s.entry);
    return { houseNY, senatorsNY };
  });
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
