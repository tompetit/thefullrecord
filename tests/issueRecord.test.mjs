import assert from "node:assert/strict";
import { test } from "node:test";
import * as divisive from "../src/lib/divisive.ts";
import { loadTs } from "./helpers/loadTs.mjs";

const { partySplit } = divisive;
const { summarizeByIssue } = loadTs("../src/lib/issueRecord.ts", { "./divisive": divisive });

const party = (k) => k[0];
const votes = (dy, dn, ry, rn) => Object.fromEntries([
  ...Array.from({ length: dy }, (_, i) => [`Dy${i}`, "yes"]), ...Array.from({ length: dn }, (_, i) => [`Dn${i}`, "no"]),
  ...Array.from({ length: ry }, (_, i) => [`Ry${i}`, "yes"]), ...Array.from({ length: rn }, (_, i) => [`Rn${i}`, "no"]),
]);
const input = (id, vote, split, topics, extra = {}) => ({
  vote, split, topics, kind: "substantive", bill: id,
  example: { id, href: `/vote/x/${id}`, title: id, date: "2026-01-01", dateLabel: "Jan 1, 2026", sourceUrl: "https://example.gov", outcome: "Passed", vote },
  ...extra,
});
const partyLine = partySplit(votes(10, 0, 0, 9), party);
const close = partySplit(votes(5, 5, 5, 4), party);
const unanimous = partySplit(votes(10, 0, 9, 0), party);

test("counts divided substantive votes per topic, with and against party", () => {
  const rows = summarizeByIssue("D", [
    input("a", "yes", partyLine, ["housing"]),
    input("b", "no", partyLine, ["housing", "economy"]),
    input("c", "yes", close, ["economy"]),
    input("d", "yes", unanimous, ["housing"]),
    input("e", "yes", partyLine, ["health"], { kind: "procedural" }),
    input("f", "yes", partyLine, ["health"]),
    input("g", "yes", partyLine, []),
  ], 3, 1);
  const housing = rows.find((r) => r.topic === "housing");
  assert.deepEqual([housing.total, housing.yes, housing.no, housing.withParty, housing.againstParty], [2, 1, 1, 1, 1]);
  const economy = rows.find((r) => r.topic === "economy");
  // the close vote has no clear D majority (5–5), so it counts but is not scored
  assert.deepEqual([economy.total, economy.withParty, economy.againstParty], [2, 0, 1]);
  assert.equal(rows.find((r) => r.topic === "health").total, 1);
  assert.equal(rows[0].total >= rows.at(-1).total, true);
  assert.deepEqual(Array.from(economy.examples, (e) => e.id), ["b", "c"]); // most contested (closest tally, widest party gap) first
});

test("null below the minimum of tagged divided votes", () => {
  assert.equal(summarizeByIssue("D", [input("a", "yes", partyLine, ["housing"])]), null);
});
