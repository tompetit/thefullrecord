import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyIssues, filterIssueRecords, parseIssueTopics } from '../src/lib/issues.ts';

const records = [
  { id: 'housing', bill: 'S101', title: 'Rental assistance', summary: 'Assistance for tenants', chamber: 'NY SENATE', kind: 'substantive', topics: ['housing'] },
  { id: 'both', bill: 'S102', title: 'Energy efficiency in dwellings', chamber: 'NY SENATE', kind: 'substantive', topics: ['housing', 'climate'] },
  { id: 'procedure', bill: 'H.R. 25', title: 'Motion to proceed on student loans', chamber: 'U.S. SENATE', kind: 'procedural', question: 'On the Cloture Motion', topics: ['education'] },
  { id: 'unclassified', bill: 'S105', title: 'A technical correction', chamber: 'NY SENATE', kind: 'substantive', topics: [] },
];
const defaults = { topics: [], query: '', chamber: '', kind: '' };

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
