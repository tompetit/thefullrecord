import test from 'node:test';
import assert from 'node:assert/strict';
import * as usStates from '../src/lib/usStates.ts';
import { loadTs } from './helpers/loadTs.mjs';

const lib = loadTs('../src/lib/issues.ts', { './usStates': usStates });
// loadTs runs in another realm; copy results so deepEqual sees plain local arrays.
const plain = (value) => JSON.parse(JSON.stringify(value));
const classifyIssues = (...args) => plain(lib.classifyIssues(...args));
const filterIssueRecords = (...args) => plain(lib.filterIssueRecords(...args));
const parseIssueTopics = (...args) => plain(lib.parseIssueTopics(...args));
const chamberOptions = (...args) => plain(lib.chamberOptions(...args));
const { chamberLabel } = lib;

const records = [
  { id: 'housing', bill: 'S101', title: 'Rental assistance', summary: 'Assistance for tenants', chamber: 'NY SENATE', kind: 'substantive', split: true, splitKind: 'party-line', close: false, topics: ['housing'] },
  { id: 'both', bill: 'S102', title: 'Energy efficiency in dwellings', chamber: 'NY SENATE', kind: 'substantive', split: false, splitKind: 'unanimous', close: false, topics: ['housing', 'climate'] },
  { id: 'procedure', bill: 'H.R. 25', title: 'Motion to proceed on student loans', chamber: 'U.S. SENATE', kind: 'procedural', split: true, splitKind: 'party-line', close: false, question: 'On the Cloture Motion', topics: ['education'] },
  { id: 'unclassified', bill: 'S105', title: 'A technical correction', chamber: 'NY SENATE', kind: 'substantive', split: false, splitKind: 'unanimous', close: false, topics: [] },
];
const defaults = { topics: [], query: '', chamber: '', kind: '', show: 'all' };

test('classification allows overlapping issues without assigning a policy stance', () => {
  assert.deepEqual(classifyIssues('Energy efficiency in multiple dwellings'), ['housing', 'climate']);
  assert.deepEqual(classifyIssues('Student loans', 'Rules for consumer debt'), ['education', 'economy']);
  assert.deepEqual(classifyIssues('Military hostilities in Iran'), ['foreign']);
});

test('classification matches whole words, normalizes punctuation, and does not invent a tag', () => {
  assert.deepEqual(classifyIssues('Chairperson repair authority'), []);
  assert.deepEqual(classifyIssues('AI-chatbot toys for children'), ['education', 'technology']);
  assert.deepEqual(classifyIssues('A technical correction'), []);
});

test('multiple topics are an inclusive union and overlapping votes appear once', () => {
  assert.deepEqual(filterIssueRecords(records, { ...defaults, topics: ['housing', 'climate'] }).map((r) => r.id), ['housing', 'both']);
});

test('search, chamber, and vote type combine while preserving source ordering', () => {
  assert.deepEqual(filterIssueRecords(records, { ...defaults, query: '  HR-not-found  ' }), []);
  assert.deepEqual(filterIssueRecords(records, { ...defaults, query: 'h.r. 25', chamber: 'U.S. SENATE', kind: 'procedural' }).map((r) => r.id), ['procedure']);
  assert.deepEqual(filterIssueRecords(records, { ...defaults, query: 'tenants' }).map((r) => r.id), ['housing']);
  assert.deepEqual(filterIssueRecords(records, { ...defaults, topics: ['education'], kind: 'substantive' }), []);
});

test('unclassified records remain discoverable and no-filter view never drops them', () => {
  assert.deepEqual(filterIssueRecords(records, defaults), records);
  assert.deepEqual(filterIssueRecords(records, { ...defaults, topics: ['other'] }).map((r) => r.id), ['unclassified']);
  assert.deepEqual(filterIssueRecords(records, { ...defaults, topics: ['other', 'housing'] }).map((r) => r.id), ['housing', 'both', 'unclassified']);
});


test('the exact procedural question is searchable and can supply an otherwise missing topic', () => {
  assert.deepEqual(filterIssueRecords(records, { ...defaults, query: 'cloture' }).map((r) => r.id), ['procedure']);
  assert.deepEqual(classifyIssues('S100', '', 'On an amendment concerning housing'), ['housing']);
});


test('shareable topics preserve valid multiple selections and reject unknown or duplicate ids', () => {
  assert.deepEqual(parseIssueTopics('housing,health'), ['housing', 'health']);
  assert.deepEqual(parseIssueTopics('housing'), ['housing']);
  assert.deepEqual(parseIssueTopics('housing,bogus,housing,other'), ['housing', 'other']);
  assert.deepEqual(parseIssueTopics(''), []);
});

test('show filters: split is the default, and typing a search includes unanimous votes', () => {
  assert.deepEqual(filterIssueRecords(records, { ...defaults, show: '' }).map((r) => r.id), ['housing', 'procedure']);
  assert.deepEqual(filterIssueRecords(records, { ...defaults, show: 'split', query: 'technical' }).map((r) => r.id), ['unclassified']);
  assert.deepEqual(filterIssueRecords(records, { ...defaults, show: 'party-line' }).map((r) => r.id), ['housing', 'procedure']);
  assert.deepEqual(filterIssueRecords(records, { ...defaults, show: 'crossed' }), []);
  assert.deepEqual(filterIssueRecords([{ ...records[0], close: true }, records[1]], { ...defaults, show: 'close' }).map((r) => r.id), ['housing']);
});

test('where local representatives split', () => {
  const rep = (vote) => ({ id: vote, name: vote, role: '', vote });
  const mixed = { ...records[0], representatives: [rep('yes'), rep('no')] };
  const agree = { ...records[2], representatives: [rep('yes'), rep('yes')] };
  assert.deepEqual(filterIssueRecords([mixed, agree], { ...defaults, show: 'reps-split' }).map((r) => r.id), ['housing']);
});

test('bill numbers match after normalizing, without matching inside longer numbers', () => {
  const bills = ['H.R. 1', 'H.R. 10326', 'AB 1997', 'H.R. 1'].map((bill, i) => ({ ...records[0], id: String(i), bill, title: 'Unrelated' }));
  for (const query of ['H.R. 1', 'hr1', 'h.r.-1']) assert.deepEqual(filterIssueRecords(bills, { ...defaults, query }).map((r) => r.id), ['0', '3']);
  assert.deepEqual(filterIssueRecords(bills, { ...defaults, query: 'AB 1997' }).map((r) => r.id), ['2']);
  assert.deepEqual(filterIssueRecords(bills, { ...defaults, query: 'unrelated' }).length, 4);
});

test('chambers are readable and ordered: U.S., New York, D.C., then states', () => {
  assert.equal(chamberLabel('MD HOUSE OF DELEGATES'), 'Maryland House of Delegates');
  assert.deepEqual(chamberOptions(['WI ASSEMBLY', 'NE LEGISLATURE', 'DC COUNCIL', 'NYC COUNCIL', 'CA SENATE', 'NY ASSEMBLY', 'NY SENATE', 'U.S. SENATE', 'U.S. HOUSE', 'CA ASSEMBLY']).map((o) => o.label),
    ['U.S. House', 'U.S. Senate', 'New York Senate', 'New York Assembly', 'NYC Council', 'D.C. Council', 'California Assembly', 'California Senate', 'Nebraska Legislature', 'Wisconsin Assembly']);
});

