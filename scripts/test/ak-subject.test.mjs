// Alaska journal blocks belong to the bill their heading names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { namesOtherBill } from "../ingest/ak-subject.mjs";

test("a heading naming another bill is not this bill's vote", () => {
  assert.equal(namesOtherBill(["2026-05-19  House Journal  Page 2924", "HCR 24", "Second Reading"], "SB 282"), true);
  assert.equal(namesOtherBill(["HCS CSSB 282(STA)", "Third Reading"], "SB 282"), false);
  assert.equal(namesOtherBill(["2025-04-28  House Journal  Page 0938"], "HB 17"), false);
});

test("committee-substitute prefixes still name the bill", () => {
  assert.equal(namesOtherBill(["HCS CSSB 200(CRA) am H", "Third Reading"], "HCR 24"), true);
  assert.equal(namesOtherBill(["SCS CSHB 73(FIN)", "Concur"], "HB 73"), false);
});
