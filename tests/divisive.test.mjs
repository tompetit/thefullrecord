import assert from "node:assert/strict";
import { test } from "node:test";
import { brokeWithParty, contention, partySplit } from "../src/lib/divisive.ts";

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

import { standoutSentence, summarizeStandout, topStandoutVotes } from "../src/lib/divisive.ts";

test("summarizeStandout counts breaks from party majority", () => {
  const meta = (d, kind = "substantive") => ({ id: d, bill: "B", title: "T", kind, date: d, dateLabel: d, sourceUrl: "u", chamber: "H" });
  const split = partySplit(votes({ D: [20, 0], R: [1, 19] }), party);
  const inputs = (v) => Array.from({ length: 5 }, (_, i) => ({ vote: v, split, meta: meta(`2026-0${i + 1}-01`, i === 4 ? "procedural" : "substantive") }));
  const s = summarizeStandout("R", inputs("yes"));
  assert.equal(s.m, 5);
  assert.equal(s.n, 5);
  assert.equal(s.votes[0].breakdown, "Democrats 20–0, Republicans 1–19");
  assert.equal(topStandoutVotes(s, 5)[4].kind, "procedural");
  assert.equal(standoutSentence(s), "Voted against most of their party on 5 of 5 party-divided votes on file.");
  assert.equal(summarizeStandout("R", inputs("no")).n, 0);
  assert.equal(summarizeStandout("I", inputs("no")), null);
  assert.equal(summarizeStandout("R", inputs("no").slice(0, 4)), null);
  assert.match(standoutSentence({ m: 12, n: 0 }), /all 12/);
});

test("summarizeStandout: top 3 topics of breaking votes, only with >= 5 tagged", async () => {
  const { summarizeStandout } = await import("../src/lib/divisive.ts");
  const split = partySplit(votes({ D: [10, 0], R: [0, 10] }), party);
  const input = (vote, topics) => ({ vote, split, topics, meta: { date: "2026-01-01" } });
  const mk = (n) => [
    ...Array.from({ length: 5 }, () => input("yes", ["economy"])), // R majority voted no: these break
    ...Array.from({ length: n }, () => input("yes", ["health", "economy"])),
  ];
  assert.equal(summarizeStandout("R", mk(0)).n, 5);
  assert.deepEqual(summarizeStandout("R", mk(0)).topTopics, [["economy", 5]]);
  assert.deepEqual(summarizeStandout("R", mk(2)).topTopics, [["economy", 7], ["health", 2]]);
  const few = [...Array.from({ length: 4 }, () => input("yes", ["economy"])), ...Array.from({ length: 6 }, () => input("yes", []))];
  assert.equal(summarizeStandout("R", few).topTopics, undefined);
});

test("contention: unanimous 0, party-line close high, bipartisan lopsided low, procedural halved", () => {
  assert.equal(contention(partySplit(votes({ D: [5, 0], R: [4, 0] }), party), "substantive"), 0);
  const close = partySplit(votes({ D: [3, 211], R: [215, 3] }), party);
  const high = contention(close, "substantive");
  assert.ok(high > 0.9, String(high));
  const low = contention(partySplit(votes({ D: [45, 5], R: [45, 5] }), party), "substantive");
  assert.ok(low < 0.15, String(low));
  assert.equal(contention(close, "procedural"), high / 2);
});
