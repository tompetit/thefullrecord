import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv } from "../src/lib/csv.ts";
import { loadTs } from "./helpers/loadTs.mjs";

const { buildCongressRoster, parseStateRoster } = loadTs("../src/server/live/rosters.ts", { "../../lib/csv": { parseCsv } });
const leg = (bioguide, name, terms) => ({ id: { bioguide }, name: { official_full: name, first: name, last: name }, terms });
const rep = (state, district, party = "Democrat", extra = {}) => ({ type: "rep", start: "2025-01-03", end: "2027-01-03", state, district, party, ...extra });
const sen = (state, start, party = "Democrat") => ({ type: "sen", start, end: "2029-01-03", state, party });

test("congress roster keys House seats, at-large seats and delegates", () => {
  const roster = buildCongressRoster([
    leg("A1", "Alice", [rep("TX", 18)]),
    leg("A2", "Al At-Large", [rep("AK", 0, "Republican")]),
    leg("A3", "Dee Delegate", [rep("DC", 0)]),
    leg("A4", "Pat Commissioner", [rep("PR", 0, "Republican")]),
  ]);
  assert.equal(roster.house.get("tx-18").name, "Alice");
  assert.equal(roster.house.get("tx-18").delegate, false);
  assert.equal(roster.house.get("ak-al").party, "R");
  assert.equal(roster.house.get("dc-al").delegate, true);
  assert.equal(roster.house.get("pr-al").delegate, true);
  assert.equal(roster.house.has("ak-0"), false);
});
test("senators are ordered senior first by first Senate term start, and independents keep their label", () => {
  const roster = buildCongressRoster([
    leg("S2", "Junior", [rep("NY", 3), sen("NY", "2011-01-03")]),
    leg("S1", "Senior", [sen("NY", "1999-01-03")]),
    leg("S3", "Indie", [sen("VT", "2007-01-04", "Independent")]),
  ]);
  assert.equal(roster.senators.get("ny").map((s) => s.bioguide).join(","), "S1,S2");
  const indie = roster.senators.get("vt")[0];
  assert.equal(indie.party, null);
  assert.equal(indie.partyLabel, "Independent");
  assert.equal(indie.termEnd, "2029-01-03");
});

const header = "id,name,current_party,current_district,current_chamber,links,sources";
const rows = (n) => Array.from({ length: n }, (_, i) => `ocd-person/00000000-0000-0000-0000-00000000000${i},Member ${i},Democratic,${i + 1},lower,,https://example.org/${i}`);
test("state roster parsing maps party, chamber, id and links", () => {
  const csv = [
    header,
    'ocd-person/11111111-1111-1111-1111-111111111111,"Doe, Jane",Republican,14,upper,https://senate.example.gov/jane;https://x.test,https://ballotpedia.org/Jane',
    "ocd-person/22222222-2222-2222-2222-222222222222,Sam Indy,Independent,At-Large,legislature,,https://ballotpedia.org/Sam;https://council.example.gov/sam",
    "ocd-person/33333333-3333-3333-3333-333333333333,No Links,Democratic,3,lower,,",
    ...rows(3),
  ].join("\n");
  const members = parseStateRoster(csv, "tx");
  assert.equal(members.length, 6);
  assert.deepEqual(
    { ...members[0] },
    { id: "11111111-1111-1111-1111-111111111111", name: "Doe, Jane", party: "R", chamber: "upper", districtLabel: "14", district: "14", url: "https://senate.example.gov/jane" }
  );
  assert.equal(members[1].party, null);
  assert.equal(members[1].partyLabel, "Independent");
  assert.equal(members[1].url, "https://council.example.gov/sam");
  assert.equal(members[2].url, "https://openstates.org/tx/legislators/");
});
test("a suspiciously small state roster throws so the failure is retryable", () => {
  assert.throws(() => parseStateRoster(`${header}\n${rows(2).join("\n")}`, "tx"), /too small/);
});
