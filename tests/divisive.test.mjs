import assert from "node:assert/strict";
import { test } from "node:test";
import { brokeWithParty, partySplit } from "../src/lib/divisive.ts";

// keys like "D1" carry their party in the first letter
const party = (k) => (k === "?" ? undefined : k[0]);
const votes = (spec) =>
  Object.fromEntries(
    Object.entries(spec).flatMap(([k, [y, n]]) => [
      ...Array.from({ length: y }, (_, i) => [`${k}y${i}`, "yes"]),
      ...Array.from({ length: n }, (_, i) => [`${k}n${i}`, "no"]),
    ]),
  );

test("unanimous: no 'no' or no 'yes'", () => {
  const s = partySplit(votes({ D: [5, 0], R: [4, 0] }), party);
  assert.equal(s.kind, "unanimous");
  assert.equal(s.close, false);
  assert.equal(partySplit({ a: "absent" }, party).kind, "unanimous");
});

test("party-line, crossed, bipartisan", () => {
  assert.equal(partySplit(votes({ D: [10, 0], R: [0, 10] }), party).kind, "party-line");
  assert.equal(partySplit(votes({ D: [10, 0], R: [1, 9] }), party).kind, "party-line");
  assert.equal(partySplit(votes({ D: [8, 2], R: [0, 10] }), party).kind, "crossed");
  assert.equal(partySplit(votes({ D: [9, 1], R: [8, 2] }), party).kind, "bipartisan");
});

test("unknown without enough D and R data", () => {
  assert.equal(partySplit(votes({ D: [5, 5] }), party).kind, "unknown");
  assert.equal(partySplit(votes({ D: [1, 0], R: [0, 1] }), party).kind, "unknown");
  assert.equal(partySplit({ "?": "yes", "??": "no" }, () => undefined).kind, "unknown");
});

test("close: margin <= max(2, 5%)", () => {
  assert.equal(partySplit(votes({ D: [51, 0], R: [0, 49] }), party).close, true);
  assert.equal(partySplit(votes({ D: [56, 0], R: [0, 44] }), party).close, false);
  assert.equal(partySplit(votes({ D: [2, 0], R: [0, 1] }), party).close, true);
  assert.equal(partySplit(votes({ D: [5, 0], R: [5, 0] }), party).close, false);
});

test("brokeWithParty", () => {
  const s = partySplit(votes({ D: [8, 2], R: [0, 10], I: [1, 0] }), party);
  assert.equal(brokeWithParty("no", "D", s), true);
  assert.equal(brokeWithParty("yes", "D", s), false);
  assert.equal(brokeWithParty("yes", "R", s), true);
  assert.equal(brokeWithParty("absent", "D", s), false);
  assert.equal(brokeWithParty("yes", "I", s), false); // one voter: no majority
  assert.equal(brokeWithParty("yes", undefined, s), false);
  const tie = partySplit(votes({ D: [3, 3], R: [0, 4] }), party);
  assert.equal(brokeWithParty("yes", "D", tie), false);
});
