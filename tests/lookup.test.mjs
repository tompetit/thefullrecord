import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../src/server/live/lookup.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const district = { state: "NY", matchedAddress: "A verified New York address", councilDistrict: "1", assemblyDistrict: "1", stateSenateDistrict: "1", congressionalDistrict: "1" };
const roster = new Map([["1", { name: "Verified official", url: "https://example.org" }]]);
function lookup({ geocode = async () => district, rosters = {} } = {}) {
  const exports = {};
  const dependencies = {
    "../data": { officials: [] },
    "./geocode": { lookupDistricts: geocode },
    "./snapshot": { snapshotVotes: () => [], snapshotMemberParty: () => null },
    "./rosters": {
      getCouncilRoster: async () => roster,
      getAssemblyRoster: async () => roster,
      getStateSenateRoster: async () => roster,
      getCongressRoster: async () => ({ houseNY: roster, senatorsNY: [...roster.values(), ...roster.values()] }),
      ...rosters,
    },
  };
  vm.runInNewContext(source, { exports, require: (key) => dependencies[key] });
  return exports.lookupOfficials;
}
const outage = async () => { throw new Error("Service outage"); };
test("a failed roster does not discard the other verified chambers", async () => {
  const result = await lookup({ rosters: { getCouncilRoster: outage } })("test");
  assert.equal(result.ok, true);
  assert.equal(result.groups.reduce((sum, group) => sum + group.officials.length, 0), 5);
  assert.equal(result.groups.some((group) => group.level === "city"), false);
});
test("a total roster outage produces a retryable failure, not an empty success", async () => {
  const result = await lookup({ rosters: { getCouncilRoster: outage, getAssemblyRoster: outage, getStateSenateRoster: outage, getCongressRoster: outage } })("test");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "lookup-failed");
});
test("a geocoder failure, no match and outside-NY match remain distinct", async () => {
  for (const [geocode, reason] of [[outage, "lookup-failed"], [async () => null, "no-match"], [async () => ({ ...district, state: "NJ" }), "outside-ny"]]) {
    const result = await lookup({ geocode })("test");
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  }
});
