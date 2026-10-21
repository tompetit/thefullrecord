import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGeneralTable, partyCode, normalizeDistrict } from '../ingest/candidates-states.mjs';

const html = readFileSync(new URL('./fixtures/bp-slates-sample.html', import.meta.url), 'utf8');

test('slate table: parties, incumbents, third parties and multi-member seats', () => {
  const [tx14, tx2, az3] = parseGeneralTable(html);
  assert.deepEqual(tx14.candidates.map((c) => [c.name, c.parties[0], c.incumbent]), [['Janet Dudding', 'D', false], ['Paul Dyson', 'R', true], ['Jeff Miller', 'LIB', false]]);
  assert.equal(tx2.office, 'District 2');
  assert.equal(tx2.seats, 1);
  assert.equal(az3.seats, 2);
  assert.equal(az3.candidates.length, 5);
  assert.deepEqual(az3.candidates.at(-1).parties, ['No Labels']);
});

test('party labels map to short codes, else verbatim minus " Party"', () => {
  assert.deepEqual(['Libertarian Party', 'Green Party', 'Independent', 'Working Families Party'].map(partyCode), ['LIB', 'G', 'IND', 'Working Families']);
});

test('district labels normalise to Open States names', () => {
  const known = new Set(['12', '1A', 'Hillsborough 12']);
  assert.equal(normalizeDistrict('TX', 'lower', 'District 12', known), '12');
  assert.equal(normalizeDistrict('MN', 'lower', 'District 1A', known), '1A');
  assert.equal(normalizeDistrict('TX', 'lower', 'District 99', known), null);
});

test('state-specific label fixes: MA ordinals, VT suffix/typo, WA positions, vacant seats', () => {
  assert.equal(normalizeDistrict('MA', 'upper', '2nd Essex and Middlesex District', new Set(['Second Essex and Middlesex'])), 'Second Essex and Middlesex');
  assert.equal(normalizeDistrict('MA', 'lower', '7th Hampden District', new Set(['7th Hampden'])), '7th Hampden');
  assert.equal(normalizeDistrict('VT', 'lower', 'Chittenden 3 District', new Set(['Chittenden-3'])), 'Chittenden-3');
  assert.equal(normalizeDistrict('VT', 'lower', 'Windham-Windsor-Bennigton District', new Set(['Windham-Windsor-Bennington'])), 'Windham-Windsor-Bennington');
  assert.equal(normalizeDistrict('WA', 'lower', 'District 24-Position 2', new Set(['24'])), '24');
  assert.deepEqual(normalizeDistrict('NH', 'lower', 'Coos 6', new Set(['Coos 1']), true), { vacant: 'Coos 6' });
  assert.equal(normalizeDistrict('VT', 'upper', 'Essex District', new Set(['Orange']), true), null);
});
