import assert from "node:assert/strict";
import { test } from "node:test";
import { transformBills, mapOpenStatesVote } from "../scripts/ingest/openstates-transform.mjs";
import { isOfficialStateSource, validateSnapshot } from "../scripts/ingest/shared.mjs";

const P = (n) => `ocd-person/0000000${n}-0000-0000-0000-000000000000`;
const vote = (extra) => ({
  id: "ocd-vote/aaaaaaaa-0000-0000-0000-000000000001",
  motion_text: "Third reading and final passage",
  motion_classification: ["passage"],
  start_date: "2025-08-25",
  result: "pass",
  organization: { classification: "lower" },
  counts: [{ option: "yes", value: 90 }, { option: "no", value: 50 }],
  sources: [{ url: "https://capitol.texas.gov/BillLookup/Votes.aspx?id=1" }],
  votes: [
    { option: "yes", voter_name: "A", voter: { id: P(1) } },
    { option: "no", voter_name: "B", voter: { id: P(2) } },
    { option: "excused", voter_name: "C", voter: { id: P(3) } },
    { option: "abstain", voter_name: "D", voter: { id: P(4) } },
    { option: "not voting", voter_name: "E", voter: { id: P(5) } },
    { option: "other", voter_name: "F", voter: { id: P(6) } },
    { option: "yes", voter_name: "G, no id", voter: null },
  ],
  ...extra,
});
const bills = [
  { identifier: "HB 20", title: "Relating to charitable solicitations", sources: [{ url: "https://capitol.texas.gov/bill" }], votes: [
    vote({}),
    vote({ id: "ocd-vote/aaaaaaaa-0000-0000-0000-000000000002", organization: { classification: "upper" }, motion_text: "Motion to adjourn", motion_classification: [], start_date: "2025-08-26T10:00:00-05:00", sources: [] }),
    vote({ id: "ocd-vote/aaaaaaaa-0000-0000-0000-000000000003", organization: { classification: "committee" } }),
    vote({ id: "ocd-vote/aaaaaaaa-0000-0000-0000-000000000004", votes: [{ option: "yes", voter_name: "X", voter: null }] }),
    vote({ id: "ocd-vote/aaaaaaaa-0000-0000-0000-000000000005", sources: [{ url: "https://example.com/news" }] }),
  ] },
];
bills[0].votes[4].start_date = "2025-08-27"; // non-gov source and bill source below
bills.push({ identifier: "SB 1", title: "Blogged bill", sources: [{ url: "https://example.com/bill" }], votes: [vote({ id: "ocd-vote/aaaaaaaa-0000-0000-0000-000000000009", sources: [{ url: "https://example.com/vote" }] })] });

test("vote mapping follows the spec", () => {
  assert.deepEqual(["yes", "no", "absent", "not voting", "excused", "abstain", "other", "??"].map(mapOpenStatesVote), ["yes", "no", "absent", "absent", "absent", "present", "present", null]);
});
test("v3 bills become per-chamber snapshots keyed by ocd-person id", () => {
  const { snapshots, skipped } = transformBills(bills, "tx", "2026-01-01T00:00:00Z");
  assert.deepEqual([...snapshots.keys()].sort(), ["lower", "upper"]);
  const lower = snapshots.get("lower");
  assert.equal(lower.chamber, "TX HOUSE");
  assert.equal(lower.sourceLabel, "Roll call · Texas House (via Open States)");
  assert.equal(lower.keyBy, "openstates");
  assert.equal(lower.jurisdiction, "tx");
  assert.equal(lower.legislativeChamber, "lower");
  assert.equal(snapshots.get("upper").chamber, "TX SENATE");
  const roll = lower.rollCalls.find((r) => r.id === "os-tx-aaaaaaaa-0000-0000-0000-000000000001");
  assert.equal(roll.bill, "HB 20");
  assert.equal(roll.kind, "substantive");
  assert.equal(roll.outcome, "Passed 90–50");
  assert.equal(roll.date, "2025-08-25");
  assert.equal(roll.dateLabel, "Aug 25, 2025");
  assert.equal(roll.sourceUrl, "https://capitol.texas.gov/BillLookup/Votes.aspx?id=1");
  assert.equal(JSON.stringify(roll.votes), JSON.stringify({ [P(1)]: "yes", [P(2)]: "no", [P(3)]: "absent", [P(4)]: "present", [P(5)]: "absent", [P(6)]: "present" }));
  const upper = snapshots.get("upper").rollCalls[0];
  assert.equal(upper.kind, "procedural");
  assert.equal(upper.date, "2025-08-26");
  assert.equal(upper.sourceUrl, "https://capitol.texas.gov/bill", "falls back to the bill's official source");
  assert.equal(skipped["not-floor-vote"], 1);
  assert.equal(skipped["no-identified-voters"], 1);
  assert.equal(skipped["no-official-source"], 1);
});
test("generated snapshots pass validation and the --max-votes cap keeps the newest", () => {
  const { snapshots } = transformBills(bills, "tx", "2026-01-01T00:00:00Z");
  for (const s of snapshots.values()) validateSnapshot(s);
  const capped = transformBills(bills, "tx", "2026-01-01T00:00:00Z", 1);
  assert.equal(capped.snapshots.get("lower").rollCalls.length, 1);
});
test("http:// legislature URLs are upgraded to https", () => {
  const b = [{ identifier: "AB 1", title: "T", sources: [], votes: [vote({ sources: [{ url: "http://leginfo.legislature.ca.gov/faces/x" }] })] }];
  const { snapshots } = transformBills(b, "ca", "2026-01-01T00:00:00Z");
  assert.equal(snapshots.get("lower").rollCalls[0].sourceUrl, "https://leginfo.legislature.ca.gov/faces/x");
});
test("future-dated events are rejected", () => {
  const { snapshots } = transformBills(bills, "tx", "2025-01-01T00:00:00Z");
  assert.equal(snapshots.size, 0);
});
test("official-source rule for state sites", () => {
  for (const ok of ["https://capitol.texas.gov/x", "https://www.leg.state.fl.us/x", "https://malegislature.gov/x", "https://le.utah.gov"]) assert.equal(isOfficialStateSource(ok), true, ok);
  for (const bad of ["http://capitol.texas.gov/x", "https://example.com/vote", "https://ballotpedia.org/x", "not a url"]) assert.equal(isOfficialStateSource(bad), false, bad);
});
