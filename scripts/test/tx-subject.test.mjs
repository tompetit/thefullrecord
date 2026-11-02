// Texas Senate headings that the bill attribution depends on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HEAD_S } from "../ingest/tx-subject.mjs";

test("committee-substitute and no-space headings are recognised", () => {
  assert.deepEqual(HEAD_S.exec("COMMITTEE SUBSTITUTESENATE BILL 11 ON THIRD READING")?.slice(1), ["SENATE BILL", "11"]);
  assert.deepEqual(HEAD_S.exec("SENATE CONCURRENT RESOLUTION 8ON SECOND READING")?.slice(1), ["SENATE CONCURRENT RESOLUTION", "8"]);
  assert.deepEqual(HEAD_S.exec("SENATE BILL 1253 ON THIRD READING")?.slice(1), ["SENATE BILL", "1253"]);
});
