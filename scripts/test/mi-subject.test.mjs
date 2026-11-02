// Michigan journals: a roll call belongs to the measure on the floor, not to the last bill heading printed before it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { subjectAt } from "../ingest/mi-subject.mjs";

const at = (text) => subjectAt(text, text.length)?.bill ?? null;

test("a bill only introduced earlier in the day does not take the vote on an initiative petition", () => {
  const text = "House Bill No. 6246, entitled\nA bill to amend 1 PA 2.\nThe bill was read a first time by its title and referred to the Committee on Government Operations.\n"
    + "Initiative Petition No. 1\nINITIATIVE PETITION\nAn initiation of legislation to amend 1976 PA 388.\nWas read a third time, and the question being on its passage, by yeas and nays, as follows:";
  assert.equal(at(text), "IP 1");
});

test("a bill that was just introduced is not the subject of a later non-bill roll call", () => {
  assert.equal(at("House Bill No. 6246, entitled\nA bill to amend 1 PA 2.\nThe bill was read a first time by its title and referred to the Committee on Tax Policy.\nRep. Smith moved that the House adjourn, by yeas and nays, as follows:"), null);
});

test("lettered joint resolutions and unnumbered-heading concurrent resolutions are recognized", () => {
  assert.equal(at("House Bill No. 5975, entitled\nA bill to amend 1 PA 2.\nHouse Joint Resolution U, entitled\nA joint resolution proposing an amendment.\nWas read a third time and not adopted, by yeas and nays, as follows:"), "HJR U");
  assert.equal(at("Senate Bill No. 5, entitled\nA bill to amend 1 PA 2.\nSenate Concurrent Resolution No. 14.A concurrent resolution to approve an extension.\nThe question being on concurring in the substitute, as follows:"), "SCR 14");
});

test("a bill still in third reading keeps its own vote", () => {
  assert.equal(at("House Bill No. 4001, entitled\nA bill to amend 1 PA 2.\nWas read a third time and passed, by yeas and nays, as follows:"), "HB 4001");
});

test("snapshot: previously misattributed Michigan roll calls are on the right measure", () => {
  const load = (c) => JSON.parse(readFileSync(new URL(`../../src/server/snapshot/state-mi-${c}.json`, import.meta.url), "utf8")).rollCalls;
  const all = new Map([...load("lower"), ...load("upper")].map((r) => [r.id, r]));
  assert.equal(all.get("mi-h-20260825-343").bill, "IP 1");
  assert.equal(all.get("mi-h-20260603-170").bill, "HJR U");
  assert.equal(all.get("mi-s-20260701-167").bill, "SCR 14");
  assert.equal(all.get("mi-s-20251029-288").bill, "SCR 7");
  assert.equal(all.get("mi-s-20260616-118").title, "The home rule village act: add section 24e.");
  for (const r of all.values()) assert.doesNotMatch(r.title, /\(This bill|\(For text of/, r.id);
});
