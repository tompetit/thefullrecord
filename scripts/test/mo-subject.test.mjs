// Missouri journals: a conference substitute is the bill labelled before "entitled:", not a bill its title refers to; long descriptions still count as "taken up".
import { test } from "node:test";
import assert from "node:assert/strict";
import { entitledBill, takenUpAfter } from "../ingest/mo-subject.mjs";

test("a conference committee substitute is the bill labelled before 'entitled:'", () => {
  const t = "On motion of Senator Henderson, CCS for HCS for SS for SCS for SB 68, entitled: CONFERENCE COMMITTEE SUBSTITUTE FOR SENATE BILL NO. 68 An Act to repeal section 161.026 as enacted by house bill no. 1606, and section 161.026 as enacted by senate bill no. 743, relating to education. Was read the 3rd time and passed by the following vote:";
  assert.equal(entitledBill(t, t.length), "SB 68");
});

test("a vote block printed since the title means the title is not the subject", () => {
  const t = "On motion of Senator X, SS for SB 9, entitled: An Act. Was read the 3rd time and passed by the following vote: YEAS 3 Vacancies—None The emergency clause was adopted by the following vote:";
  assert.equal(entitledBill(t, t.length), null);
});

test("a bill with a description longer than 260 characters is still 'taken up'", () => {
  assert.ok(takenUpAfter(`HB 12, to appropriate money ${"for expenses, ".repeat(60)}was taken up by Representative Deaton. Speaker Pro Tem assumed the Chair.`));
  assert.ok(!takenUpAfter("HB 12, relating to roads, was referred to the committee. The bill was taken up by Representative Deaton."));
});
