import test from 'node:test';
import assert from 'node:assert/strict';
import { sameName, nameTokens } from '../scripts/test/address-check.mjs';

test('oracle name matching ignores middle initials, suffixes, accents and nicknames', () => {
  assert.ok(sameName('Lloyd Doggett', 'Lloyd Doggett II'));
  assert.ok(sameName('Angela D. Alsobrooks', 'Angela Alsobrooks'));
  assert.ok(sameName('Nydia M. Velázquez', 'Nydia Velazquez'));
  assert.ok(sameName('Robert "Bobby" Scott', 'Robert C. Scott'));
  assert.ok(sameName('Catherine Cortez Masto', 'Catherine Masto'));
  assert.ok(sameName('Lisa Blunt Rochester', 'Lisa Rochester'));
  assert.ok(sameName("Beth O'Brien", 'Beth OBrien'));
  assert.ok(sameName('Mary Smith-Jones', 'Mary Jones'));
});

test('oracle name matching still tells different people apart', () => {
  assert.ok(!sameName('Mike Johnson', 'Dusty Johnson')); // same last name, different first initial
  assert.ok(!sameName('Mike Johnson', 'Mike Jackson'));
  assert.ok(!sameName('', 'Mike Johnson'));
});

test('nameTokens drops suffixes and quoted nicknames', () => {
  assert.deepEqual(nameTokens('Martin "Marty" Jr. Smith'), ['martin', 'smith']);
});
