import assert from "node:assert/strict";
import { test } from "node:test";
import * as stateDistricts from "../src/lib/stateDistricts.ts";
import * as usStates from "../src/lib/usStates.ts";
import { loadTs } from "./helpers/loadTs.mjs";

const named = (basename, name = basename) => ({ basename, name });
const nyDistrict = {
  state: "NY", matchedAddress: "A verified New York address", councilDistrict: "1", assemblyDistrict: "1", stateSenateDistrict: "1", congressionalDistrict: "1",
  ballotLegislative: { upper: named("1"), lower: named("1") },
  current: { congressionalDistrict: "1", upper: named("1"), lower: named("1"), source: "tigerweb-2024" },
};
const txDistrict = {
  state: "TX", matchedAddress: "1100 CONGRESS AVE, AUSTIN, TX, 78701", councilDistrict: null, assemblyDistrict: "49", stateSenateDistrict: "14", congressionalDistrict: "10",
  ballotLegislative: { upper: named("14", "State Senate District 14"), lower: named("49", "State House District 49") },
  current: { congressionalDistrict: "37", upper: named("14", "State Senate District 14"), lower: named("49", "State House District 49"), source: "tigerweb-2024" },
};
const nyRoster = new Map([["1", { name: "Verified official", url: "https://example.org" }]]);
const member = (name, bioguide, extra = {}) => ({ name, bioguide, url: "https://example.org", party: "D", district: "", delegate: false, termEnd: "2029-01-03", state: "TX", ...extra });
const congress = {
  house: new Map([
    ["ny-1", member("NY Rep", "N1")], ["tx-37", member("Lloyd Doggett", "D000399")], ["tx-10", member("Someone Else", "X1")],
    ["dc-al", member("Dee Delegate", "D1", { delegate: true })], ["ak-al", member("Al At-Large", "A1")],
  ]),
  senators: new Map([
    ["ny", [member("NY Sen One", "NS1"), member("NY Sen Two", "NS2")]],
    ["tx", [member("TX Sen One", "TS1"), member("TX Sen Two", "TS2")]],
  ]),
};
const osMember = (id, name, chamber, districtLabel, extra = {}) => ({ id, name, chamber, districtLabel, district: districtLabel, party: "D", url: "https://example.org", ...extra });
const U = (n) => `0000000${n}-0000-0000-0000-000000000000`;
const txMembers = [
  osMember(U(1), "Sen Fourteen", "upper", "14"),
  osMember(U(2), "Rep Fortynine", "lower", "49"),
  osMember(U(3), "Rep Other", "lower", "50"),
];
function lookup({ geocode = async () => nyDistrict, rosters = {} } = {}) {
  const { lookupOfficials } = loadTs("../src/server/live/lookup.ts", {
    "../data": { officials: [] },
    "../../lib/stateDistricts": stateDistricts,
    "../../lib/usStates": usStates,
    "./geocode": { lookupDistricts: geocode },
    "./snapshot": { snapshotVotes: () => [], snapshotMemberParty: () => null },
    "./rosters": {
      getCouncilRoster: async () => nyRoster,
      getAssemblyRoster: async () => nyRoster,
      getStateSenateRoster: async () => nyRoster,
      getCongressRoster: async () => congress,
      getStateLegislatureRoster: async () => txMembers,
      ...rosters,
    },
  });
  return lookupOfficials;
}
const outage = async () => { throw new Error("Service outage"); };
const count = (r) => r.groups.reduce((sum, g) => sum + g.officials.length, 0);

test("New York is unchanged: council, assembly, senate, house and both senators", async () => {
  const result = await lookup()("test");
  assert.equal(result.ok, true);
  assert.equal(count(result), 6);
  assert.equal(result.groups.map((g) => g.label).join("|"), "CITY — NYC COUNCIL|STATE — ALBANY|FEDERAL — U.S. CONGRESS");
  const keys = result.groups.flatMap((g) => g.officials.map((o) => o.districtKey)).sort().join(",");
  assert.equal(keys, "ny-ad-1,ny-sd-1,nyc-council-1,us-house-ny-1,us-sen-ny-1,us-sen-ny-2");
});
test("a failed roster does not discard the other verified chambers", async () => {
  const result = await lookup({ rosters: { getCouncilRoster: outage } })("test");
  assert.equal(result.ok, true);
  assert.equal(count(result), 5);
  assert.equal(result.groups.some((g) => g.level === "city"), false);
});
test("a total roster outage produces a retryable failure, not an empty success", async () => {
  const result = await lookup({ rosters: { getCouncilRoster: outage, getAssemblyRoster: outage, getStateSenateRoster: outage, getCongressRoster: outage } })("test");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "lookup-failed");
});
test("a geocoder failure and a no-match remain distinct", async () => {
  for (const [geocode, reason] of [[outage, "lookup-failed"], [async () => null, "no-match"]]) {
    const result = await lookup({ geocode })("test");
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  }
});
test("a non-NY address returns Congress by TODAY's district plus matched state legislators", async () => {
  const result = await lookup({ geocode: async () => txDistrict })("test");
  assert.equal(result.ok, true);
  assert.equal(result.groups.map((g) => g.label).join("|"), "STATE — TEXAS LEGISLATURE|FEDERAL — U.S. CONGRESS");
  const [state, federal] = result.groups;
  assert.equal(state.officials.map((o) => o.districtKey).join(","), `tx-upper-${U(1)},tx-lower-${U(2)}`);
  assert.equal(state.officials[0].role, "State Senator · District 14");
  assert.equal(state.officials[1].role, "State Representative · District 49");
  assert.match(state.officials[0].methodologyNote, /not yet in our dataset/);
  assert.match(state.officials[0].teaser.text, /aren't in our dataset yet/);
  assert.equal(federal.officials.map((o) => o.districtKey).join(","), "us-house-tx-37,us-sen-tx-1,us-sen-tx-2");
  assert.equal(federal.officials[0].name, "Lloyd Doggett");
  assert.equal(result.context.houseDistrictChange.ballotSeat, "us-house-tx-10");
  assert.equal(result.context.houseDistrictChange.ballotLabel, "TX-10");
  assert.equal(result.context.houseDistrictChange.currentLabel, "TX-37");
  assert.equal(result.context.gaps.length, 0);
});
test("a state-roster outage keeps the federal results", async () => {
  const result = await lookup({ geocode: async () => txDistrict, rosters: { getStateLegislatureRoster: outage } })("test");
  assert.equal(result.ok, true);
  assert.equal(result.groups.map((g) => g.level).join(","), "federal");
});
test("a vacancy is reported as a gap, never filled", async () => {
  const d = { ...txDistrict, current: { ...txDistrict.current, upper: named("99", "State Senate District 99") } };
  const result = await lookup({ geocode: async () => d })("test");
  assert.equal(result.groups[0].officials.length, 1);
  assert.match(result.context.gaps[0], /No current member listed for State Senate district State Senate District 99 .*may be vacant/);
});
test("a vacant U.S. House seat is reported as a gap (e.g. TX-23), not silently dropped", async () => {
  const d = { ...txDistrict, current: { ...txDistrict.current, congressionalDistrict: "23" } };
  const result = await lookup({ geocode: async () => d })("test");
  const federal = result.groups.find((g) => g.level === "federal");
  assert.equal(federal.officials.some((o) => o.districtKey.startsWith("us-house-")), false);
  assert.equal(federal.officials.length, 2);
  assert.match(result.context.gaps[0], /No current U\.S\. Representative is listed for TX-23.*vacant/);
});
test("when TIGERweb is unavailable the fallback source is surfaced and no district change is claimed", async () => {
  const d = { ...txDistrict, current: { ...txDistrict.current, congressionalDistrict: "10", source: "census-2026-fallback" } };
  const result = await lookup({ geocode: async () => d })("test");
  assert.equal(result.context.geographySource, "census-2026-fallback");
  assert.equal(result.context.houseDistrictChange, undefined);
});
test("D.C. gets a city council group (wards, at-large, chair) and a delegate, no senators", async () => {
  const dc = [
    osMember(U(1), "Ward Two", "legislature", "Ward 2"),
    osMember(U(2), "Chair Person", "legislature", "Chairman"),
    osMember(U(3), "At Large", "legislature", "At-Large"),
    osMember(U(4), "Ward Three", "legislature", "Ward 3"),
  ];
  const d = { state: "DC", matchedAddress: "DC", councilDistrict: null, assemblyDistrict: null, stateSenateDistrict: "2", congressionalDistrict: "98",
    ballotLegislative: { upper: named("2", "Ward 2"), lower: null },
    current: { congressionalDistrict: "98", upper: named("2", "Ward 2"), lower: null, source: "tigerweb-2024" } };
  const result = await lookup({ geocode: async () => d, rosters: { getStateLegislatureRoster: async () => dc } })("test");
  const [city, federal] = result.groups;
  assert.equal(city.label, "CITY — D.C. COUNCIL");
  assert.equal(city.officials.map((o) => o.role).join("|"), "Council Member · Ward 2|Council Chair|Council Member · At-large");
  assert.equal(federal.officials.length, 1);
  assert.match(federal.officials[0].role, /^Delegate · U\.S\. House/);
});
test("New Hampshire lookups carry the floterial-district note", async () => {
  const nh = [osMember(U(1), "Coos Five", "lower", "Coos 5"), osMember(U(2), "Sen", "upper", "1"), osMember(U(3), "Sen2", "upper", "2")];
  const d = { ...txDistrict, state: "NH", current: { congressionalDistrict: "1", upper: named("01"), lower: named("Coos 05", "State House District Coos 05"), source: "tigerweb-2024" } };
  const result = await lookup({ geocode: async () => d, rosters: { getStateLegislatureRoster: async () => nh } })("test");
  assert.match(result.context.notes.join(" "), /floterial/);
  assert.equal(result.groups[0].officials.map((o) => o.name).join(","), "Sen,Coos Five");
});
