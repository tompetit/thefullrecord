import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/loadTs.mjs";

const cand = (name, extra = {}) => ({ name, parties: ["Democratic"], incumbent: false, ...extra });
const races = {
  "us-sen-ga": { id: "us-sen-ga", electionDate: "2026-11-03", sources: [], candidates: [cand("Jon Ossoff", { incumbent: true }), cand("Challenger")] },
  "us-sen-id": { id: "us-sen-id", electionDate: "2026-11-03", sources: [], candidates: [cand("James E. Risch", { bioguideId: "R000584", incumbent: true })] },
  "us-house-tx-37": { id: "us-house-tx-37", electionDate: "2026-11-03", sources: [], candidates: [cand("New Person", { incumbent: false })] },
  "us-house-tx-10": { id: "us-house-tx-10", electionDate: "2026-11-03", sources: [], candidates: [cand("Michael McCaul", { incumbent: true })] },
};
const m = (name, bioguide, termEnd) => ({ name, bioguide, termEnd });
const roster = {
  senators: new Map([
    ["ga", [m("Jon Ossoff", "O000174", "2027-01-03"), m("Raphael Warnock", "W000790", "2029-01-03")]],
    ["id", [m("Michael D. Crapo", "C000880", "2029-01-03"), m("James E. Risch", "R000584", "2027-01-03")]],
    ["ny", [m("Charles E. Schumer", "S000148", "2029-01-03"), m("Kirsten E. Gillibrand", "G000555", "2031-01-03")]],
  ]),
  house: new Map([["tx-37", m("Lloyd Doggett", "D000399", "2027-01-03")], ["tx-10", m("Michael McCaul", "M001157", "2027-01-03")]]),
};
const slatesJson = JSON.stringify({
  election: { name: "2026 general election", date: "2026-11-03", dateLabel: "Nov 3, 2026" },
  seats: [
    { districtKey: "tx-lower-1", candidates: [cand("A")], sourceUrl: "u", sourceLabel: "Ballotpedia" },
    { districtKey: "nh-lower-Hillsborough 7", seats: 3, candidates: [cand("B")], sourceUrl: "u", sourceLabel: "Ballotpedia" },
  ],
});
const U1 = "11111111-1111-1111-1111-111111111111";
const stateRoster = {
  tx: [{ id: U1, chamber: "lower", districtLabel: "1" }, { id: "22222222-2222-2222-2222-222222222222", chamber: "upper", districtLabel: "1" }],
  nh: [{ id: U1, chamber: "lower", districtLabel: "Hillsborough 7" }],
};
const { electionForSeat, stateSlates, parseSlateKey } = loadTs("../src/server/live/elections.ts", {
  "node:fs": { readFileSync: () => slatesJson, readdirSync: () => ["candidates-x.json"] },
  "node:path": { join: (...p) => p.join("/") },
  "../guide/load": { getRace: (id) => races[id] ?? null },
  "./rosters": { getCongressRoster: async () => roster, getStateLegislatureRoster: async (st) => stateRoster[st] ?? [] },
}, { process: { cwd: () => "/" } });

test("a senator on the 2026 ballot is matched by incumbent surname or bioguide id", async () => {
  const ga = await electionForSeat("us-sen-ga-1");
  assert.equal(ga.candidates.length, 2);
  assert.equal(ga.dateLabel, "Nov 3, 2026");
  const id = await electionForSeat("us-sen-id-2");
  assert.equal(id.candidates[0].name, "James E. Risch");
});
test("a senator not on the 2026 ballot gets the next election year from the term end", async () => {
  assert.equal((await electionForSeat("us-sen-ga-2")).nextElectionLabel, "2028");
  assert.equal((await electionForSeat("us-sen-ny-1")).nextElectionLabel, "2028");
  assert.equal((await electionForSeat("us-sen-ny-2")).nextElectionLabel, "2030");
  assert.equal((await electionForSeat("us-sen-id-1")).nextElectionLabel, "2028");
});
test("a House race with a different incumbent is not presented as this seat's race", async () => {
  assert.equal(await electionForSeat("us-house-tx-37"), null);
  assert.equal((await electionForSeat("us-house-tx-10")).candidates[0].name, "Michael McCaul");
});
test("NYC Council seats keep their 2029 note", async () => {
  assert.equal((await electionForSeat("nyc-council-4")).nextElectionLabel, "2029");
});

test("a state legislator joins to the slate by chamber and district label", async () => {
  assert.equal((await electionForSeat(`tx-lower-${U1}`)).candidates[0].name, "A");
  assert.equal((await electionForSeat(`nh-lower-${U1}`)).seats, 3);
  // Same district label, but no senate slate in the file: no claim
  assert.equal(await electionForSeat("tx-upper-22222222-2222-2222-2222-222222222222"), null);
  assert.equal(await electionForSeat(`la-lower-${U1}`), null);
});
test("stateSlates lists a state's seats; parseSlateKey splits chamber and label", () => {
  assert.equal(stateSlates("TX").length, 1);
  assert.equal(parseSlateKey("nh-lower-Hillsborough 7").label, "Hillsborough 7");
});
