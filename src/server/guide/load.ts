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
  Position,
  Stance,
  StateVote,
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
  landmark: Record<string, Array<StateVote & { id: string }>>;
  stateVotes: Record<string, StateVote[]>;
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
type VoteIssue = { issue: IssueKey; yes: Stance; why?: string };

const OBBBA: VoteIssue[] = [
  { issue: "healthcare_public", yes: "opposes", why: "which reduced federal Medicaid spending and added Medicaid work requirements" },
  { issue: "immigration_enforcement", yes: "supports", why: "which funded expanded immigration enforcement, detention and border operations" },
  { issue: "climate", yes: "opposes", why: "which phased out Inflation Reduction Act clean-energy tax credits" },
  { issue: "tax_wealthy", yes: "opposes", why: "which made the 2017 individual tax rates, including the 37% top rate, permanent" },
];

/** Key votes that bear directly on an ISSUES statement. `why` names the provision. */
const VOTE_ISSUES: Record<string, VoteIssue[]> = {
  "h-2025-23": [{ issue: "immigration_enforcement", yes: "supports" }],
  "s-2025-7": [{ issue: "immigration_enforcement", yes: "supports" }],
  "h-2026-11": [{ issue: "healthcare_public", yes: "supports" }],
  "h-2026-65": [{ issue: "tariffs", yes: "opposes" }],
  "s-2025-225": [{ issue: "tariffs", yes: "opposes" }],
  "s-2025-600": [{ issue: "tariffs", yes: "opposes" }],
  // Landmark votes from earlier Congresses (current and former members)
  "h-2010-165": [{ issue: "healthcare_public", yes: "supports" }],
  "h-2017-256": [{ issue: "healthcare_public", yes: "opposes", why: "which would have capped federal Medicaid funding and ended enhanced funding for the Medicaid expansion" }],
  "h-2017-699": [{ issue: "tax_wealthy", yes: "opposes", why: "which cut the corporate tax rate from 35% to 21% and the top individual rate from 39.6% to 37%" }],
  "h-2021-385": [
    { issue: "climate", yes: "supports", why: "which would have funded clean-energy tax credits" },
    { issue: "universal_childcare", yes: "supports", why: "which would have funded universal pre-K and child-care subsidies" },
  ],
  "h-2022-420": [
    { issue: "climate", yes: "supports", why: "which enacted clean-energy and climate tax credits" },
    { issue: "tax_wealthy", yes: "supports", why: "which added a 15% minimum tax on large corporations and a stock-buyback excise tax" },
  ],
  "h-2019-99": [{ issue: "guns", yes: "supports" }],
  "h-2022-410": [{ issue: "guns", yes: "supports" }],
  "h-2022-299": [{ issue: "guns", yes: "supports" }],
  "h-2017-663": [{ issue: "guns", yes: "opposes" }],
  "h-2019-496": [{ issue: "minimum_wage", yes: "supports" }],
  "h-2021-295": [{ issue: "abortion", yes: "supports" }],
  "h-2022-360": [{ issue: "abortion", yes: "supports" }],
  "h-2017-549": [{ issue: "abortion", yes: "opposes" }],
  "h-2023-209": [{ issue: "immigration_enforcement", yes: "supports" }],
  "h-2019-240": [{ issue: "immigration_enforcement", yes: "opposes" }],
  "h-2021-91": [{ issue: "immigration_enforcement", yes: "opposes" }],
  "h-2025-145": OBBBA,
  "h-2025-190": OBBBA,
  "s-2025-372": OBBBA,
};

const BILL_SOURCES: Record<string, { id: string; url: string; title: string }> = {
  "H.R. 1": {
    id: "bill-hr1-119",
    url: "https://www.congress.gov/bill/119th-congress/house-bill/1",
    title: "H.R. 1 (119th Congress) — One Big Beautiful Bill Act: text and summary",
  },
};

/**
 * Recorded floor votes outrank campaign statements: where key votes bear on an
 * issue, the vote-derived stance becomes the position, and any stated position
 * on the same issue is kept alongside it as `stated`.
 */
function addVotePositions(race: GuideRace, c: GuideCandidate) {
  const defs = new Map(getKeyVoteDefs().map((d) => [d.id, d]));
  const byIssue = new Map<IssueKey, Array<{ stance: Stance; def: KeyVoteDef; vote: string; why?: string }>>();
  for (const kv of c.keyVotes ?? []) {
    const def = defs.get(kv.voteId);
    if (!def || (kv.vote !== "yes" && kv.vote !== "no")) continue;
    for (const map of VOTE_ISSUES[kv.voteId] ?? []) {
      const stance: Stance = kv.vote === "yes" ? map.yes : map.yes === "supports" ? "opposes" : "supports";
      byIssue.set(map.issue, [...(byIssue.get(map.issue) ?? []), { stance, def, vote: kv.vote, why: map.why }]);
    }
  }
  const addSource = (src: GuideRace["sources"][number]) => {
    if (!race.sources.some((s) => s.id === src.id)) race.sources.push(src);
    return src.id;
  };
  for (const [issue, votes] of byIssue) {
    const sourceIds = new Set<string>();
    for (const { def } of votes) {
      sourceIds.add(
        addSource({
          id: `kv-${def.id}`,
          url: def.sourceUrl,
          title: `Roll call: ${def.shortTitle}`,
          publisher: def.chamber === "house" ? "Office of the Clerk, U.S. House" : "U.S. Senate",
          kind: "official",
          date: def.date,
        }),
      );
      const bill = BILL_SOURCES[def.bill];
      if (bill && votes.some((v) => v.why)) sourceIds.add(addSource({ ...bill, publisher: "Congress.gov", kind: "official" }));
    }
    const stances = new Set(votes.map((v) => v.stance));
    // One sentence per bill (House and Senate passage of the same bill read as one line).
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const { def, vote, why } of votes) {
      const k = `${def.bill}|${vote}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const dates = votes.filter((v) => v.def.bill === def.bill && v.vote === vote).map((v) => v.def.date);
      lines.push(`Voted ${vote} on ${def.shortTitle.replace(/ — .*$/, "")} (${def.bill}, ${dates.join("; ")})${why ? `, ${why}` : ""}.`);
    }
    const existing = c.positions.findIndex((p) => p.issue === issue);
    const prior = existing >= 0 ? c.positions[existing] : undefined;
    const pos: Position = {
      issue,
      stance: stances.size === 1 ? votes[0].stance : "mixed",
      summary: lines.join(" "),
      sources: [...sourceIds],
      basis: "votes",
      ...(prior ? { stated: { stance: prior.stance, summary: prior.summary, quote: prior.quote, sources: prior.sources } } : {}),
    };
    if (existing >= 0) c.positions[existing] = pos;
    else c.positions.push(pos);
  }
}

/** Landmark Albany votes that squarely address an issue statement. */
const NY_VOTE_ISSUES: Record<string, VoteIssue> = {
  "nya-2019-S06458": { issue: "rent_regulation", yes: "supports" },
  "nya-2019-S06599": { issue: "climate", yes: "supports" },
  "nya-2019-S02451": { issue: "guns", yes: "supports" },
  "nya-2021-S51001": { issue: "guns", yes: "supports" },
  "nya-2019-S00240": { issue: "abortion", yes: "supports" },
  "nya-2019-A02176": { issue: "immigration_enforcement", yes: "opposes" },
  "nya-2021-S02509": { issue: "tax_wealthy", yes: "supports" },
};

/** Same precedence as congressional votes: recorded Albany votes outrank statements. */
function addStateVotePositions(race: GuideRace, c: GuideCandidate, votes: Array<StateVote & { id: string }>) {
  const byIssue = new Map<IssueKey, Array<{ stance: Stance; v: StateVote & { id: string } }>>();
  for (const v of votes) {
    const map = NY_VOTE_ISSUES[v.id];
    if (!map || (v.vote !== "yes" && v.vote !== "no")) continue;
    const stance: Stance = v.vote === "yes" ? map.yes : map.yes === "supports" ? "opposes" : "supports";
    byIssue.set(map.issue, [...(byIssue.get(map.issue) ?? []), { stance, v }]);
  }
  for (const [issue, list] of byIssue) {
    const sources = list.map(({ v }) => {
      const id = `ny-${v.id}`;
      if (!race.sources.some((s) => s.id === id))
        race.sources.push({ id, url: v.sourceUrl, title: `Assembly floor vote: ${v.bill} — ${v.title}`, publisher: "New York State Assembly", kind: "official", date: v.date });
      return id;
    });
    const stances = new Set(list.map((x) => x.stance));
    const existing = c.positions.findIndex((p) => p.issue === issue);
    const prior = existing >= 0 ? c.positions[existing] : undefined;
    if (prior?.basis === "votes") continue;
    const pos: Position = {
      issue,
      stance: stances.size === 1 ? list[0].stance : "mixed",
      summary: list.map(({ v }) => `Voted ${v.vote} on ${v.bill} (${v.title}, ${v.date}): ${v.summary}`).join(" "),
      sources,
      basis: "votes",
      ...(prior ? { stated: { stance: prior.stance, summary: prior.summary, quote: prior.quote, sources: prior.sources } } : {}),
    };
    if (existing >= 0) c.positions[existing] = pos;
    else c.positions.push(pos);
  }
}

function load(): Map<string, GuideRace> {
  if (races) return races;
  const enrich: Enrichment = {
    finance: readJson(join(GEN_DIR, "finance.json"), {}),
    members: readJson(join(GEN_DIR, "members.json"), {}),
    stateVotes: readJson(join(GEN_DIR, "state-votes.json"), {}),
    landmark: readJson(join(GEN_DIR, "ny-landmark-votes.json"), {}),
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
      const sv = enrich.stateVotes[key];
      const lm = enrich.landmark[key];
      if (sv || lm) c.stateVotes = [...(lm ?? []), ...(sv ?? [])];
      if (lm) addStateVotePositions(race, c, lm);
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
