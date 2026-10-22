// Kansas snapshot regressions: title as of the vote, line-item vetoes on the right bill, official outcomes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const load = (c) => JSON.parse(readFileSync(new URL(`../../src/server/snapshot/state-ks-${c}.json`, import.meta.url), "utf8")).rollCalls;
const all = new Map([...load("lower"), ...load("upper")].map((r) => [r.id, r]));

test("KS titles are the version voted on, not the bill's later title", () => {
  assert.match(all.get("ks-s-20250319-vote_199_SB231").title, /^Modifying the requirements for soliciting registered voters/);
});

test("KS Senate line-item veto overrides belong to HB 2513, not HB 2315", () => {
  for (const r of all.values()) if (/Line Item Veto/i.test(r.id)) assert.equal(r.bill, "HB 2513", r.id);
});

test("KS outcomes follow the official result text", () => {
  assert.match(all.get("ks-h-20250410-0386_SB125").outcome, /^Failed/);
  assert.match(all.get("ks-s-20260410-vote_396_Line Item Veto Override 54(y)").outcome, /^Failed 25–14/);
  assert.match(all.get("ks-h-20250319-0254_HCR5001").outcome, /^Failed/);
  assert.match(all.get("ks-s-20250326-vote_271_HCR5011").question, /not adopt Conference Committee Report/);
  assert.match(all.get("ks-h-20250320-0277_SB137").question, /Amendment by Rep\. Linda Featherston was rejected/);
});
