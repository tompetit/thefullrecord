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
const { electionForSeat } = loadTs("../src/server/live/elections.ts", {
  "node:fs": { readFileSync: () => "", readdirSync: () => [] },
  "node:path": { join: (...p) => p.join("/") },
  "../guide/load": { getRace: (id) => races[id] ?? null },
  "./rosters": { getCongressRoster: async () => roster },
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
