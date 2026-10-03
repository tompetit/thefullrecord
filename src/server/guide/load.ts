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
  RecordedVote,
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
  senateLandmark: Record<string, Array<StateVote & { id: string }>>;
  stateVotes: Record<string, StateVote[]>;
  cosponsors: CosponsorData;
}

interface LinkHealth {
  checkedAt?: string;
  results: Record<string, { status: string; archivedUrl?: string }>;
}

let linkHealth: LinkHealth["results"] | null = null;

/** Static, build-time results of `npm run guide:check-links`. */
function getLinkHealth(): LinkHealth["results"] {
  if (!linkHealth) linkHealth = readJson<LinkHealth>(join(ROOT, "link-health.json"), { results: {} }).results;
  return linkHealth;
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
 * Editorial topic associations for browsing exact votes. They do not establish
 * a broad policy stance, including when a vote concerns an omnibus bill.
 */
/**
 * `yes`: which way a Yes vote points relative to the ISSUES statement. Set only
 * when the bill's central effect squarely matches the statement (and `why` names
 * the provision when the bill is broad). Used to compare single votes with a
 * voter's answer — never to infer a candidate's overall stance.
 * Directions reviewed 2026-10-03 by Claude (AI editor — review delegated by site owner).
 */
type VoteIssue = { issue: IssueKey; why?: string; yes?: "supports" | "opposes" };

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
  "h-2026-11": [{ issue: "healthcare_public", yes: "supports", why: "which extended enhanced ACA premium subsidies" }],
  "h-2026-65": [{ issue: "tariffs", yes: "opposes", why: "which disapproved the tariffs on Canadian imports" }],
  "s-2025-225": [{ issue: "tariffs", yes: "opposes", why: "which would have ended the emergency used to impose global tariffs" }],
  "s-2025-600": [{ issue: "tariffs", yes: "opposes", why: "which would end the emergency used to impose global tariffs" }],
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
  "h-2019-99": [{ issue: "guns", yes: "supports", why: "which would have required background checks on most private gun sales" }],
  "h-2022-410": [{ issue: "guns", yes: "supports", why: "which would have banned the sale of many semiautomatic assault weapons" }],
  "h-2022-299": [{ issue: "guns", yes: "supports", why: "which expanded background checks for buyers under 21 and funded state red-flag programs" }],
  "h-2017-663": [{ issue: "guns", yes: "opposes", why: "which would have required states to honor other states' concealed-carry permits" }],
  "h-2019-496": [{ issue: "minimum_wage", yes: "supports" }],
  "h-2021-295": [{ issue: "abortion", yes: "supports" }],
  "h-2022-360": [{ issue: "abortion", yes: "supports" }],
  "h-2017-549": [{ issue: "abortion", yes: "opposes", why: "which would have banned most abortions after 20 weeks" }],
  "h-2023-209": [{ issue: "immigration_enforcement", yes: "supports" }],
  "h-2019-240": [{ issue: "immigration_enforcement" }],
  "h-2021-91": [{ issue: "immigration_enforcement" }],
  // New statements (October 2026)
  "h-2025-102": [{ issue: "voter_citizenship_proof", yes: "supports" }],
  "h-2025-346": [{ issue: "war_powers", yes: "supports", why: "which would have directed the removal of U.S. forces from hostilities against Venezuela absent congressional authorization" }],
  "h-2026-199": [{ issue: "war_powers", yes: "supports", why: "which directed the removal of U.S. forces from hostilities against Iran absent congressional authorization" }],
  "s-2025-328": [{ issue: "war_powers", yes: "supports", why: "a motion to bring a war powers resolution on Iran to a vote" }],
  "s-2025-608": [{ issue: "war_powers", yes: "supports", why: "a motion to bring a war powers resolution on Venezuela to a vote" }],
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
 * Put exact recorded votes beside stated positions without inferring an overall
 * stance from a vote or treating a no vote as support for the opposite policy.
 */
function addVotePositions(race: GuideRace, c: GuideCandidate) {
  const defs = new Map(getKeyVoteDefs().map((d) => [d.id, d]));
  const byIssue = new Map<IssueKey, Array<{ def: KeyVoteDef; vote: "yes" | "no"; why?: string; yesMeans?: "supports" | "opposes" }>>();
  for (const kv of c.keyVotes ?? []) {
    const def = defs.get(kv.voteId);
    if (!def || (kv.vote !== "yes" && kv.vote !== "no")) continue;
    for (const map of VOTE_ISSUES[kv.voteId] ?? []) {
      byIssue.set(map.issue, [...(byIssue.get(map.issue) ?? []), { def, vote: kv.vote, why: map.why, yesMeans: map.yes }]);
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
      // Bill numbers repeat each Congress; H.R. 1 from 2017 is not H.R. 1 from 2025.
      const bill = def.year === 2025 || def.year === 2026 ? BILL_SOURCES[def.bill] : undefined;
      if (bill && votes.some((v) => v.why)) sourceIds.add(addSource({ ...bill, publisher: "Congress.gov", kind: "official" }));
    }
    // One sentence per bill (House and Senate passage of the same bill read as one line).
    const seen = new Set<string>();
    const lines: string[] = [];
    const recorded: RecordedVote[] = [];
    for (const { def, vote, why, yesMeans } of votes) {
      const k = `${def.bill}|${vote}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const same = votes.filter((v) => v.def.bill === def.bill && v.vote === vote);
      const line = `Voted ${vote} on ${def.shortTitle.replace(/ — .*$/, "")} (${def.bill}, ${same.map((v) => v.def.date).join("; ")})${why ? `, ${why}` : ""}.`;
      lines.push(line);
      recorded.push({ text: line, vote, yesMeans, sources: same.map((v) => `kv-${v.def.id}`) });
    }
    const existing = c.positions.findIndex((p) => p.issue === issue);
    const prior = existing >= 0 ? c.positions[existing] : undefined;
    const pos: Position = {
      issue,
      stance: "not_inferred",
      summary: lines.join(" "),
      sources: [...sourceIds],
      basis: "votes",
      votes: recorded,
      ...(prior && prior.basis !== "votes" ? { stated: { stance: prior.stance, summary: prior.summary, quote: prior.quote, sources: prior.sources } } : {}),
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
  "nys-2019-S6458": { issue: "rent_regulation", yes: "supports" },
  "nys-2019-S6599": { issue: "climate", yes: "supports" },
  "nys-2019-S2451": { issue: "guns", yes: "supports" },
  "nys-2021-S51001": { issue: "guns", yes: "supports" },
  "nys-2019-S240": { issue: "abortion", yes: "supports" },
  "nys-2019-S425": { issue: "immigration_enforcement", yes: "opposes" },
  "nys-2021-S2509": { issue: "tax_wealthy", yes: "supports" },
};

const NY_LANDMARK_SUMMARY: Record<string, string> = {
  S6458: "Made rent regulation permanent, ended vacancy decontrol and the vacancy bonus, and limited rent increases for major capital improvements.",
  S6599: "Set statewide targets of 70% renewable electricity by 2030 and an 85% cut in greenhouse-gas emissions by 2050.",
  S2451: "Allows courts to temporarily bar people found to pose a danger to themselves or others from possessing firearms.",
  S240: "Moved abortion from the penal code to the public-health law and protected access to abortion under state law.",
  S425: "Bars federal civil immigration arrests of people going to, attending, or leaving New York courthouses without a judicial warrant.",
  S51001: "Enacted after the Bruen decision: added training and character requirements for carry permits and barred guns in designated sensitive places.",
  S2509: "Raised personal income tax rates on incomes above $1 million and raised the corporate franchise tax rate on large businesses, among other revenue measures.",
};

/** Albany topic evidence also preserves exact votes without stance inference. */
function addStateVotePositions(race: GuideRace, c: GuideCandidate, votes: Array<StateVote & { id: string }>) {
  const byIssue = new Map<IssueKey, Array<{ v: StateVote & { id: string } }>>();
  for (const v of votes) {
    v.summary ??= NY_LANDMARK_SUMMARY[v.bill.replace(/-[A-Z]$/, "")];
    const map = NY_VOTE_ISSUES[v.id];
    if (!map || (v.vote !== "yes" && v.vote !== "no")) continue;
    byIssue.set(map.issue, [...(byIssue.get(map.issue) ?? []), { v }]);
  }
  for (const [issue, list] of byIssue) {
    const sources = list.map(({ v }) => {
      const id = `ny-${v.id}`;
      if (!race.sources.some((s) => s.id === id))
        race.sources.push({ id, url: v.sourceUrl, title: `${v.chamber === "senate" ? "Senate" : "Assembly"} floor vote: ${v.bill} — ${v.title}`, publisher: v.chamber === "senate" ? "New York State Senate" : "New York State Assembly", kind: "official", date: v.date });
      return id;
    });
    const existing = c.positions.findIndex((p) => p.issue === issue);
    const prior = existing >= 0 ? c.positions[existing] : undefined;
    if (prior?.basis === "votes") continue;
    const recorded: RecordedVote[] = list.map(({ v }, i) => ({
      text: `Voted ${v.vote} on ${v.bill} (${v.title}, ${v.date})${v.summary ? `: ${v.summary}` : "."}`,
      vote: v.vote as "yes" | "no",
      yesMeans: NY_VOTE_ISSUES[v.id]?.yes,
      sources: [sources[i]],
    }));
    const pos: Position = {
      issue,
      stance: "not_inferred",
      summary: recorded.map((r) => r.text).join(" "),
      sources,
      basis: "votes",
      votes: recorded,
      ...(prior ? { stated: { stance: prior.stance, summary: prior.summary, quote: prior.quote, sources: prior.sources } } : {}),
    };
    if (existing >= 0) c.positions[existing] = pos;
    else c.positions.push(pos);
  }
}

interface CosponsorData {
  generatedAt: string;
  bills: Array<{ key: string; label: string; issue: IssueKey; supports: boolean; why: string; url: string; title: string; members: Record<string, "sponsor" | "cosponsor"> }>;
  candidates: Record<string, string>;
}

/**
 * Sponsoring or cosponsoring a bill whose purpose squarely matches a statement is a
 * documented position (README rule 4). Membership comes from official congress.gov
 * lists (scripts/guide/cosponsors.mjs); the bill list and directions are editorial
 * (content/guide/cosponsor-bills.json). A candidate's own statement on the issue
 * always takes precedence, so this only fills topics they haven't addressed.
 */
function addBillPositions(race: GuideRace, c: GuideCandidate, data: CosponsorData) {
  const bioguide = data.candidates[`${race.id}/${c.id}`];
  if (!bioguide) return;
  const byIssue = new Map<IssueKey, CosponsorData["bills"]>();
  for (const b of data.bills) if (b.members[bioguide]) byIssue.set(b.issue, [...(byIssue.get(b.issue) ?? []), b]);
  for (const [issue, bills] of byIssue) {
    if (c.positions.some((p) => p.issue === issue && p.basis !== "votes")) continue;
    const sources = bills.map((b) => {
      const id = `bill-${b.key}`;
      if (!race.sources.some((src) => src.id === id))
        race.sources.push({ id, url: b.url, title: `${b.label} (${b.title}) — sponsors and cosponsors`, publisher: "Congress.gov", kind: "official" });
      return id;
    });
    const directions = new Set(bills.map((b) => b.supports));
    c.positions.push({
      issue,
      stance: directions.size > 1 ? "mixed" : bills[0].supports ? "supports" : "opposes",
      summary: bills.map((b) => `${b.members[bioguide] === "sponsor" ? "Sponsored" : "Cosponsored"} ${b.label} (119th Congress), ${b.why}.`).join(" "),
      sources,
      basis: "statements",
    });
  }
}

function load(): Map<string, GuideRace> {
  if (races) return races;
  const enrich: Enrichment = {
    finance: readJson(join(GEN_DIR, "finance.json"), {}),
    members: readJson(join(GEN_DIR, "members.json"), {}),
    cosponsors: readJson<CosponsorData>(join(GEN_DIR, "cosponsors.json"), { generatedAt: "", bills: [], candidates: {} }),
    stateVotes: readJson(join(GEN_DIR, "state-votes.json"), {}),
    landmark: {
      ...readJson(join(GEN_DIR, "ny-landmark-votes.json"), {}),
    },
    senateLandmark: readJson(join(ROOT, "ny-senate-landmark.json"), {}),
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
      // Authored vote-based entries follow the same no-inference rule.
      for (const position of c.positions) {
        if (position.basis === "votes") position.stance = "not_inferred";
      }
      const key = `${race.id}/${c.id}`;
      // Before vote positions, so a bill-based stance becomes the "stated" side next to votes.
      addBillPositions(race, c, enrich.cosponsors);
      const sv = enrich.stateVotes[key];
      const lmList = [...(enrich.landmark[key] ?? []), ...(enrich.senateLandmark[key] ?? [])];
      const lm = lmList.length ? lmList : undefined;
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
    const health = getLinkHealth();
    for (const s of race.sources) {
      const h = health[s.url];
      if (h?.status === "dead") s.deadLink = h.archivedUrl ? { archivedUrl: h.archivedUrl } : {};
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
