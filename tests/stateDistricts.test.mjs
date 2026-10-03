import assert from "node:assert/strict";
import { test } from "node:test";
import { congressSeat, isAtLarge, matchDistrictLabels, normalizeDistrict } from "../src/lib/stateDistricts.ts";

test("normalizeDistrict collapses zero-pads, spacing and wording", () => {
  assert.equal(normalizeDistrict("Coos 05"), normalizeDistrict("Coos 5"));
  assert.equal(normalizeDistrict("Chittenden South East"), normalizeDistrict("Chittenden Southeast"));
  assert.equal(normalizeDistrict("Hampden, Hampshire and Worcester"), normalizeDistrict("Hampden-Hampshire-Worcester"));
  assert.equal(normalizeDistrict("State Senate District 26"), "26");
});
test("matchDistrictLabels handles each state's naming", () => {
  assert.deepEqual(matchDistrictLabels({ basename: "Coos 05" }, ["Coos 5", "Coos 4"]), ["Coos 5"]);
  assert.deepEqual(matchDistrictLabels({ basename: "Chittenden South East" }, ["Chittenden Southeast"]), ["Chittenden Southeast"]);
  assert.deepEqual(matchDistrictLabels({ basename: "Hampden, Hampshire and Worcester" }, ["Hampden-Hampshire-Worcester", "Berkshire"]), ["Hampden-Hampshire-Worcester"]);
  assert.deepEqual(matchDistrictLabels({ basename: "14th Suffolk" }, ["14th Suffolk", "1st Suffolk"]), ["14th Suffolk"]);
  assert.deepEqual(matchDistrictLabels({ basename: "2", name: "Ward 2" }, ["Ward 1", "Ward 2"]), ["Ward 2"]);
  assert.deepEqual(matchDistrictLabels({ basename: "16" }, ["16A", "16B", "17A"]), ["16A", "16B"]);
  assert.deepEqual(matchDistrictLabels({ basename: "29B" }, ["29A", "29B"]), ["29B"]);
  assert.deepEqual(matchDistrictLabels({ basename: "K" }, ["J", "K"]), ["K"]);
});
test("a lettered district matches exactly and never its sibling", () => {
  assert.deepEqual(matchDistrictLabels({ basename: "62A" }, ["62A", "62B"]), ["62A"]);
});
test("no match returns an empty list, never a guess", () => {
  assert.deepEqual(matchDistrictLabels({ basename: "99" }, ["1", "2"]), []);
  assert.deepEqual(matchDistrictLabels({ basename: "Zebra" }, ["1"]), []);
});
test("at-large labels and congressional seat suffixes", () => {
  for (const l of ["At-Large", "At Large", "Chairman", "Chair"]) assert.equal(isAtLarge(l), true);
  assert.equal(isAtLarge("Ward 2"), false);
  assert.equal(congressSeat("0"), "al");
  assert.equal(congressSeat("98"), "al");
  assert.equal(congressSeat("18"), "18");
});
