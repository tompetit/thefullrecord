#!/usr/bin/env node
/**
 * Party-line context for recorded votes: for each roll call, how each party's
 * members voted, and for each guide candidate whether their vote matched the
 * majority of their own party.
 *
 *  - Congress: party is read from the official roll-call XML (party at the time
 *    of the vote), from the cache written by enrich.mjs.
 *  - NY Legislature (2025–26 contested votes): party by district from the people
 *    index, so only roll calls from the current term are scored.
 *
 * Independents are compared with the caucus they sit with (Sanders, King: D).
 * Writes content/guide/generated/party-line.json.
 *
 * Run after enrich.mjs: node scripts/guide/party-line.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expandSnapshot } from "../ingest/shared.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GUIDE = join(ROOT, "content/guide");
const GEN = join(GUIDE, "generated");
const CACHE = join(ROOT, ".cache/guide");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

const CAUCUS = { D: "D", R: "R", I: "D", ID: "D" };
const mapVote = (v) => {
  const s = v.toLowerCase();
  if (s === "yea" || s === "aye" || s === "yes") return "yes";
  if (s === "nay" || s === "no") return "no";
  return "nv";
};

/** { D: {yes, no, nv}, R: {...} } plus each party's majority position. */
function tally(rows) {
  const t = {};
  for (const { party, vote } of rows) {
    const p = CAUCUS[party];
    if (!p) continue;
    t[p] ??= { yes: 0, no: 0, nv: 0 };
    t[p][vote]++;
  }
  const majority = {};
  for (const [p, c] of Object.entries(t)) majority[p] = c.yes === c.no ? null : c.yes > c.no ? "yes" : "no";
  return { tally: t, majority };
}

const verdict = (vote, party, majority) => {
  const p = CAUCUS[party];
  if (!p || !majority[p] || (vote !== "yes" && vote !== "no")) return null;
  return vote === majority[p] ? "with" : "against";
};

// ---------- Congress
const keyVotes = read(join(GUIDE, "key-votes.json")).votes;
const legislators = [...read(join(CACHE, "legislators-current.json")), ...read(join(CACHE, "legislators-historical.json"))];
const lisToBioguide = new Map(legislators.filter((l) => l.id.lis).map((l) => [l.id.lis, l.id.bioguide]));

const federal = {}; // voteId -> { tally, majority }
const partyAt = {}; // voteId -> bioguide -> party
for (const kv of keyVotes) {
  const xml = readFileSync(join(CACHE, `${kv.id}.xml`), "utf8");
  const rows = [];
  if (kv.chamber === "house") {
    for (const m of xml.matchAll(/<legislator name-id="([A-Z0-9]+)"[^>]*party="([A-Z]+)"[^>]*>[^<]*<\/legislator>\s*<vote>([^<]*)<\/vote>/g))
      rows.push({ id: m[1], party: m[2], vote: mapVote(m[3]) });
  } else {
    for (const m of xml.matchAll(/<member>([\s\S]*?)<\/member>/g)) {
      const lis = m[1].match(/<lis_member_id>([^<]+)</)?.[1];
      const party = m[1].match(/<party>([^<]+)</)?.[1];
      const v = m[1].match(/<vote_cast>([^<]+)</)?.[1];
      if (lis && party && v) rows.push({ id: lisToBioguide.get(lis) ?? lis, party, vote: mapVote(v) });
    }
  }
  federal[kv.id] = tally(rows);
  partyAt[kv.id] = Object.fromEntries(rows.map((r) => [r.id, r.party]));
}

const members = read(join(GEN, "members.json"));
const candidates = {}; // raceId/candidateId -> { voteId|stateKey -> "with" | "against" }
for (const [key, m] of Object.entries(members)) {
  const out = {};
  for (const kv of m.keyVotes) {
    const party = partyAt[kv.voteId]?.[m.bioguideId];
    const v = party && verdict(kv.vote, party, federal[kv.voteId].majority);
    if (v) out[kv.voteId] = v;
  }
  if (Object.keys(out).length) candidates[key] = out;
}

// ---------- NY Legislature (current term only: party by district from the people index)
const people = read(join(ROOT, "src/server/people.json"));
const districtParty = {};
for (const p of people)
  for (const o of p.offices ?? []) if (/^ny-(ad|sd)-\d+$/.test(o.officialId ?? "")) districtParty[o.officialId] = p.party;

const stateKey = (chamber, bill, date) => `${chamber.toLowerCase()}|${bill}|${date}`;
const state = {}; // stateKey -> { tally, majority }
const TERM_START = "2025-01-01";
for (const [file, prefix] of [["assembly-ny.json", "ny-ad"], ["senate-ny.json", "ny-sd"]]) {
  const snap = expandSnapshot(read(join(ROOT, "src/server/snapshot", file)));
  const district = new Map(snap.members.map((m) => [m.key, m.district]));
  for (const rc of snap.rollCalls) {
    if (rc.date < TERM_START) continue;
    const rows = Object.entries(rc.votes).map(([k, v]) => ({
      party: districtParty[`${prefix}-${district.get(k)}`],
      vote: v === "yes" ? "yes" : v === "no" ? "no" : "nv",
    }));
    state[stateKey(snap.chamber, rc.bill, rc.date)] = tally(rows);
  }
}
const stateVotes = read(join(GEN, "state-votes.json"));
const races = new Map();
for (const key of Object.keys(stateVotes)) {
  const [raceId, candId] = key.split("/");
  if (!races.has(raceId)) races.set(raceId, read(join(GUIDE, "races", `${raceId}.json`)));
  const c = races.get(raceId).candidates.find((x) => x.id === candId);
  const party = c?.parties.find((p) => CAUCUS[p]);
  if (!party) continue;
  for (const sv of stateVotes[key]) {
    const k = stateKey(sv.chamber, sv.bill, sv.date);
    const v = state[k] && verdict(sv.vote, party, state[k].majority);
    if (v) (candidates[key] ??= {})[k] = v;
  }
}

// Keep only the NY roll calls some guide candidate is shown.
const used = new Set(Object.values(candidates).flatMap((c) => Object.keys(c)));
for (const k of Object.keys(state)) if (!used.has(k)) delete state[k];
writeFileSync(
  join(GEN, "party-line.json"),
  JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), federal, state, candidates })
);
const n = Object.values(candidates).reduce((s, c) => s + Object.keys(c).length, 0);
console.log(`party-line: ${Object.keys(federal).length} federal + ${Object.keys(state).length} NY roll calls, ${n} candidate votes scored across ${Object.keys(candidates).length} candidates`);
