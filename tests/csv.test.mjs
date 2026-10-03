import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv } from "../src/lib/csv.ts";

test("parses quoted commas, escaped quotes and embedded newlines", () => {
  const rows = parseCsv('id,name,bio\r\n1,"Smith, Jane","Said ""hi""\nand left"\r\n2,Plain,\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Smith, Jane");
  assert.equal(rows[0].bio, 'Said "hi"\nand left');
  assert.deepEqual(rows[1], { id: "2", name: "Plain", bio: "" });
});
test("handles BOM, LF endings, a missing final newline and short rows", () => {
  const rows = parseCsv("﻿a,b,c\n1,2\n3,4,5");
  assert.deepEqual(rows, [{ a: "1", b: "2", c: "" }, { a: "3", b: "4", c: "5" }]);
});
test("empty input yields no rows", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("a,b\n"), []);
});
