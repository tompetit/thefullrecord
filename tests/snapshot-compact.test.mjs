import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/loadTs.mjs";
import { compactSnapshot, expandSnapshot as expandScript } from "../scripts/ingest/shared.mjs";

const { expandSnapshot } = loadTs("../src/server/live/snapshot.ts", {
  "node:fs": { readFileSync: () => "", readdirSync: () => [] },
  "node:path": { join: (...p) => p.join("/") },
}, { process: { cwd: () => "/" } });

const verbose = () => ({
  generatedAt: "2026-09-30T00:00:00.000Z",
  chamber: "U.S. HOUSE",
  sourceLabel: "Roll call · U.S. House",
  memberKeys: { "ny-10": "N000002" },
  rollCalls: [
    { id: "house-2026-1", bill: "H.R. 1", title: "T1", kind: "substantive", outcome: "Passed 2–1", date: "2026-01-02", dateLabel: "Jan 2, 2026", sourceUrl: "https://clerk.house.gov/Votes/20261", summary: "S", summarySource: "official",
      votes: { B000001: "yes", N000002: "no", C000003: "absent", D000004: "present" }, rawVotes: { B000001: "Yea" } },
    // A member who joined later has no position in earlier roll calls.
    { id: "house-2026-2", bill: "H.R. 2", title: "T2", kind: "procedural", outcome: "Failed 0–1", date: "2026-01-03", dateLabel: "Jan 3, 2026", sourceUrl: "https://clerk.house.gov/Votes/20262",
      votes: { B000001: "no", N000002: "yes", C000003: "yes", D000004: "absent", E000005: "yes" } },
  ],
});

const strip = (s) => ({ ...s, rollCalls: s.rollCalls.map((rc) => { const copy = { ...rc }; delete copy.rawVotes; return copy; }) });

test("compact snapshots expand to identical votes (loader and script agree)", () => {
  const original = verbose();
  const compact = compactSnapshot(original);
  assert.deepEqual(compact.memberIndex, ["B000001", "C000003", "D000004", "E000005", "N000002"]);
  assert.equal(compact.rollCalls[0].codes, "YAP-N");
  assert.equal(compact.rollCalls[1].codes, "NYAYY");
  assert.equal("votes" in compact.rollCalls[0], false);
  assert.equal("rawVotes" in compact.rollCalls[0], false);
  const viaLoader = JSON.parse(JSON.stringify(expandSnapshot(JSON.parse(JSON.stringify(compact)))));
  assert.deepEqual(viaLoader, JSON.parse(JSON.stringify(strip(original))));
  assert.deepEqual(JSON.parse(JSON.stringify(expandScript(compact))), JSON.parse(JSON.stringify(strip(original))));
});

test("verbose snapshots pass through the loader unchanged", () => {
  const original = verbose();
  assert.deepEqual(JSON.parse(JSON.stringify(expandSnapshot(original))), JSON.parse(JSON.stringify(original)));
});
