/**
 * Voter-guide loader. Reads the per-race research files in
 * content/guide/races/ and merges the script-generated enrichments
 * (FEC finance, congressional key votes) from content/guide/generated/.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  Finance,
  GuideCandidate,
  GuideRace,
  IssueKey,
  KeyVote,
  OfficeType,
  Stance,
} from "./types";

const ROOT = join(process.cwd(), "content/guide");
const RACES_DIR = join(ROOT, "races");
const GEN_DIR = join(ROOT, "generated");

export interface KeyVoteDef {
  id: string;
  chamber: "house" | "senate";
  year: number;
  roll: number;
  xmlUrl: string;
  sourceUrl: string;
  bill: string;
  shortTitle: string;
  question: string;
  result: string;
  date: string;
  yea: number;
  nay: number;
  topic: string;
  summary: string;
  summarySourceUrl?: string;
}

interface Enrichment {
  finance: Record<string, Finance>;
  members: Record<string, { bioguideId: string; fecId?: string; keyVotes: KeyVote[] }>;
}

let races: Map<string, GuideRace> | null = null;
let keyVoteDefs: KeyVoteDef[] | null = null;

function readJson<T>(path: string, fallback: T): T {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
  } catch (err) {
    console.error(`[guide] failed to read ${path}:`, err);
    return fallback;
  }
}

export function getKeyVoteDefs(): KeyVoteDef[] {
  if (!keyVoteDefs)
    keyVoteDefs = readJson<{ votes: KeyVoteDef[] }>(join(ROOT, "key-votes.json"), { votes: [] }).votes;
  return keyVoteDefs;
}

/**
 * Key votes that speak directly to an issue statement. A yes vote maps to
 * `yes`; a no vote to the opposite stance. Only unambiguous pairings.
 */
const VOTE_ISSUES: Record<string, { issue: IssueKey; yes: Stance }> = {
  "h-2025-23": { issue: "immigration_enforcement", yes: "supports" },
  "s-2025-7": { issue: "immigration_enforcement", yes: "supports" },
  "h-2026-11": { issue: "healthcare_public", yes: "supports" },
  "h-2026-65": { issue: "tariffs", yes: "opposes" },
  "s-2025-225": { issue: "tariffs", yes: "opposes" },
  "s-2025-600": { issue: "tariffs", yes: "opposes" },
};

/** Add vote-derived positions for issues the research didn't already document. */
function addVotePositions(race: GuideRace, c: GuideCandidate) {
  const defs = new Map(getKeyVoteDefs().map((d) => [d.id, d]));
  const byIssue = new Map<IssueKey, Array<{ stance: Stance; def: KeyVoteDef; vote: string }>>();
  for (const kv of c.keyVotes ?? []) {
    const map = VOTE_ISSUES[kv.voteId];
    const def = defs.get(kv.voteId);
    if (!map || !def || (kv.vote !== "yes" && kv.vote !== "no")) continue;
    const stance: Stance = kv.vote === "yes" ? map.yes : map.yes === "supports" ? "opposes" : "supports";
    byIssue.set(map.issue, [...(byIssue.get(map.issue) ?? []), { stance, def, vote: kv.vote }]);
  }
  for (const [issue, votes] of byIssue) {
    if (c.positions.some((p) => p.issue === issue)) continue;
    const stances = new Set(votes.map((v) => v.stance));
    const sourceIds = votes.map(({ def }) => {
      const id = `kv-${def.id}`;
      if (!race.sources.some((s) => s.id === id))
        race.sources.push({
          id,
          url: def.sourceUrl,
          title: `Roll call: ${def.shortTitle}`,
          publisher: def.chamber === "house" ? "Office of the Clerk, U.S. House" : "U.S. Senate",
          kind: "official",
          date: def.date,
        });
      return id;
    });
    c.positions.push({
      issue,
      stance: stances.size === 1 ? votes[0].stance : "mixed",
      summary: votes
        .map(({ def, vote }) => `Voted ${vote} on ${def.shortTitle.replace(/ — .*$/, "")} (${def.bill}, ${def.date}).`)
        .join(" "),
      sources: sourceIds,
    });
  }
}

function load(): Map<string, GuideRace> {
  if (races) return races;
  const enrich: Enrichment = {
    finance: readJson(join(GEN_DIR, "finance.json"), {}),
    members: readJson(join(GEN_DIR, "members.json"), {}),
  };
  const map = new Map<string, GuideRace>();
  let files: string[] = [];
  try {
    files = readdirSync(RACES_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    // no research yet
  }
  for (const file of files) {
    const race = readJson<GuideRace | null>(join(RACES_DIR, file), null);
    if (!race?.id) continue;
    for (const c of race.candidates) {
      const key = `${race.id}/${c.id}`;
      const fin = enrich.finance[key];
      if (fin) c.finance = fin;
      const mem = enrich.members[key];
      if (mem) {
        c.bioguideId = mem.bioguideId;
        c.keyVotes = mem.keyVotes;
        if (mem.fecId) c.fecId = mem.fecId;
        addVotePositions(race, c);
      }
    }
    map.set(race.id, race);
  }
  races = map;
  return map;
}

export function getAllRaces(): GuideRace[] {
  return [...load().values()].sort(compareRaces);
}

export function getRace(id: string): GuideRace | null {
  return load().get(id) ?? null;
}

export function getCandidate(
  raceId: string,
  candidateId: string
): { race: GuideRace; candidate: GuideCandidate } | null {
  const race = getRace(raceId);
  const candidate = race?.candidates.find((c) => c.id === candidateId);
  return race && candidate ? { race, candidate } : null;
}

// Roughly the order offices appear on a New York ballot
const OFFICE_ORDER: OfficeType[] = [
  "governor",
  "comptroller",
  "attorney-general",
  "us-senate",
  "us-house",
  "state-senate",
  "state-assembly",
  "ballot-measure",
  "other",
];

const districtNum = (d?: string) => (d && /^\d+$/.test(d) ? Number(d) : 0);

export function compareRaces(a: GuideRace, b: GuideRace): number {
  return (
    a.state.localeCompare(b.state) ||
    OFFICE_ORDER.indexOf(a.officeType) - OFFICE_ORDER.indexOf(b.officeType) ||
    districtNum(a.district) - districtNum(b.district) ||
    a.id.localeCompare(b.id)
  );
}

/** Races on a ballot, given where the voter lives. */
export function racesForDistricts(d: {
  state: string;
  congressionalDistrict: string | null;
  stateSenateDistrict?: string | null;
  assemblyDistrict?: string | null;
  inNYC?: boolean;
}): GuideRace[] {
  const st = d.state.toLowerCase();
  const cd =
    d.congressionalDistrict == null
      ? null
      : d.congressionalDistrict === "0" || d.congressionalDistrict === "98"
        ? "al"
        : d.congressionalDistrict;
  const all = getAllRaces().filter((r) => r.state.toLowerCase() === st);
  return all.filter((r) => {
    switch (r.officeType) {
      case "us-senate":
      case "governor":
      case "attorney-general":
      case "comptroller":
        return true;
      case "us-house":
        return cd != null && r.id === `us-house-${st}-${cd}`;
      case "state-senate":
        return d.stateSenateDistrict != null && r.id === `${st}-sd-${d.stateSenateDistrict}`;
      case "state-assembly":
        return d.assemblyDistrict != null && r.id === `${st}-ad-${d.assemblyDistrict}`;
      case "ballot-measure":
        return r.id.startsWith("nyc-") ? Boolean(d.inNYC) : true;
      default:
        return false;
    }
  });
}

/** Compact search/match index shipped to the client. */
export interface IndexCandidate {
  id: string;
  name: string;
  parties: string[];
  incumbent: boolean;
  currentRole?: string;
  positions: Partial<Record<IssueKey, Stance>>;
}

export interface IndexRace {
  id: string;
  state: string;
  officeType: OfficeType;
  title: string;
  area: string;
  inNYC: boolean;
  candidates: IndexCandidate[];
}

export function buildIndex(list: GuideRace[] = getAllRaces()): IndexRace[] {
  return list.map((r) => ({
    id: r.id,
    state: r.state,
    officeType: r.officeType,
    title: r.title,
    area: r.area,
    inNYC: r.inNYC,
    candidates: r.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      parties: c.parties,
      incumbent: c.incumbent,
      currentRole: c.currentRole,
      positions: Object.fromEntries(c.positions.map((p) => [p.issue, p.stance])),
    })),
  }));
}

export interface GuideStats {
  races: number;
  candidates: number;
  sources: number;
  officialSources: number;
  states: number;
}

export function getGuideStats(): GuideStats {
  const all = getAllRaces();
  let candidates = 0;
  let sources = 0;
  let officialSources = 0;
  for (const r of all) {
    candidates += r.candidates.length;
    sources += r.sources.length;
    officialSources += r.sources.filter((s) => s.kind === "official").length;
  }
  return {
    races: all.length,
    candidates,
    sources,
    officialSources,
    states: new Set(all.map((r) => r.state)).size,
  };
}

export interface Verification {
  raceId: string;
  checkedAt: string;
  claimsChecked: number;
  corrected: number;
  removed: number;
  unverifiable: number;
  notes: string[];
}

/** Second-pass fact-check report for a race, if one has run. */
export function getVerification(raceId: string): Verification | null {
  return readJson<Verification | null>(join(ROOT, "verification", `${raceId}.json`), null);
}
