import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/loadTs.mjs";

const { memberKeyFor } = loadTs("../src/server/live/snapshot.ts", {
  "node:fs": { readFileSync: () => "", readdirSync: () => [] },
  "node:path": { join: (...p) => p.join("/") },
}, { process: { cwd: () => "/" } });

const house = { chamber: "U.S. HOUSE", memberKeys: { "tx-37": "D000399", "ak-al": "A1", "ny-10": "N10" } };
const senate = { chamber: "U.S. SENATE", memberKeys: { "sen-tx-1": "S1", "sen-ny-2": "S2" } };
const U = "11111111-2222-3333-4444-555555555555";
const os = { chamber: "TX HOUSE", keyBy: "openstates", jurisdiction: "tx", legislativeChamber: "lower" };

test("House seats key by state and district, at-large as al", () => {
  assert.equal(memberKeyFor(house, "us-house-tx-37"), "D000399");
  assert.equal(memberKeyFor(house, "us-house-ak-al"), "A1");
  assert.equal(memberKeyFor(house, "us-house-ny-10"), "N10");
  assert.equal(memberKeyFor(house, "us-house-tx-38"), null);
});
test("Senate seats key by state and seniority", () => {
  assert.equal(memberKeyFor(senate, "us-sen-tx-1"), "S1");
  assert.equal(memberKeyFor(senate, "us-sen-ny-2"), "S2");
  assert.equal(memberKeyFor(senate, "us-sen-tx-2"), null);
});
test("Open States ids resolve only in the matching state and chamber snapshot", () => {
  assert.equal(memberKeyFor(os, `tx-lower-${U}`), `ocd-person/${U}`);
  assert.equal(memberKeyFor(os, `tx-upper-${U}`), null);
  assert.equal(memberKeyFor(os, `ca-lower-${U}`), null);
  assert.equal(memberKeyFor({ ...os, keyBy: undefined }, `tx-lower-${U}`), null);
});
test("NY keys are unchanged", () => {
  assert.equal(memberKeyFor({ chamber: "NY SENATE" }, "ny-sd-26"), "26");
  assert.equal(memberKeyFor({ chamber: "NYC COUNCIL" }, "nyc-council-33"), "33");
});
