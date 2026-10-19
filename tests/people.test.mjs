import assert from "node:assert/strict";
import { test } from "node:test";
import { addCandidate, assignSlugs, buildOfficialIndex, normName, slugify, toRow } from "../scripts/people/lib.mjs";

const official = (key, name, state, extra = {}) => ({ keys: [key], name, state, offices: [{ kind: "official", officialId: key, role: "r" }], candidacies: [], tag: "t", ...extra });
const cand = (key, name, state, extra = {}) => ({ key, name, state, tag: "t", candidacy: { office: "o", parties: ["D"] }, ...extra });

test("slugify strips accents, punctuation and apostrophes", () => {
  assert.equal(slugify("Alexandria Ocasio-Cortez"), "alexandria-ocasio-cortez");
  assert.equal(slugify("José Ñandú O'Brien Jr."), "jose-nandu-obrien-jr");
  assert.equal(slugify("***"), "person");
});

test("normName drops suffixes, nicknames and punctuation but keeps middle initials", () => {
  assert.equal(normName("Robert \"Bob\" Smith Jr."), "robert smith");
  assert.equal(normName("John A. Smith"), normName("John A Smith"));
  assert.notEqual(normName("John A. Smith"), normName("John Smith"));
  assert.equal(normName("Zoë O'Neil III"), "zoe o neil");
});

test("merge rules: bioguide, incumbent seat+surname, exact name; otherwise separate", () => {
  const people = [
    official("bio:A1", "Alice Adams", "TX", { bioguide: "A1", seats: ["us-house-tx-1"] }),
    official("os:b", "Bob Brown", "TX", { seats: ["tx-lower-12"] }),
    official("os:g", "Gina Hinojosa", "TX", { seats: ["tx-lower-49"] }),
    official("os:s1", "Sam Stone", "TX"),
    official("os:s2", "Sam Stone", "TX"),
  ];
  const idx = buildOfficialIndex(people);
  const add = (c) => addCandidate(c, idx, people);
  assert.ok(add(cand("c:1", "Alice Q. Adams", "TX", { bioguide: "A1" })));
  assert.ok(add(cand("c:2", "Robert Brown", "TX", { incumbent: true, seats: ["tx-lower-12"] })));
  assert.ok(!add(cand("c:3", "Carl Green", "TX", { incumbent: true, seats: ["tx-lower-12"] })));
  assert.ok(!add(cand("c:4", "Robert Brown", "TX", { incumbent: false, seats: ["tx-lower-12"] })));
  assert.ok(add(cand("c:5", "Gina Hinojosa", "TX")));
  assert.ok(!add(cand("c:6", "Gina Hinojosa", "OK")));
  assert.ok(!add(cand("c:7", "Sam Stone", "TX")));
  assert.deepEqual(people[2].keys, ["os:g", "c:5"]);
  assert.equal(people[2].candidacies.length, 1);
});

test("slug collisions: state, then tag, then number; deterministic", () => {
  const mk = () => [
    official("k:3", "John Smith", "TX", { tag: "house-12" }),
    official("k:2", "John Smith", "TX", { tag: "house-9" }),
    official("k:1", "John Smith", "CA"),
    official("k:4", "Jane Roe", "NY"),
    official("k:5", "Pat Poe", "NY", { tag: "x" }),
    official("k:6", "Pat Poe", "NY", { tag: "x" }),
  ];
  const slugs = (ps) => Object.fromEntries(ps.map((p) => [p.keys[0], p.slug]));
  const a = slugs(assignSlugs(mk()));
  assert.deepEqual(a, {
    "k:1": "john-smith-ca", "k:2": "john-smith-tx-house-9", "k:3": "john-smith-tx-house-12",
    "k:4": "jane-roe", "k:5": "pat-poe-ny-x", "k:6": "pat-poe-ny-x-2",
  });
  assert.deepEqual(slugs(assignSlugs(mk().reverse())), a);
});

test("slugs are stable across re-runs and never reused for someone else", () => {
  const first = assignSlugs([official("k:1", "John Smith", "TX"), official("k:9", "Gone Person", "TX")]);
  const prev = first.map(toRow);
  // k:9 left the data; a newcomer with the same name arrives; k:1 is renamed
  const second = assignSlugs([official("k:1", "Johnny Smith", "TX"), official("k:2", "John Smith", "TX"), official("k:3", "Gone Person", "TX")], prev);
  const by = Object.fromEntries(second.map((p) => [p.keys[0], p.slug]));
  assert.equal(by["k:1"], "john-smith");
  assert.equal(by["k:2"], "john-smith-tx");
  assert.equal(by["k:3"], "gone-person-tx");
  // a merged person keeps the slug of any of its earlier keys
  const merged = assignSlugs([official("os:z", "Zed Zee", "TX", { keys: ["os:z", "cand:z"] })], [{ slug: "zed-zee", key: "cand:z", name: "Zed Zee" }]);
  assert.equal(merged[0].slug, "zed-zee");
});
