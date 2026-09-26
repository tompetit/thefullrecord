import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeXml, federalVote, positiveCount, validateSnapshot, writeSnapshot } from '../ingest/shared.mjs';
import { classifyMark } from '../ingest/lrs.mjs';

const snapshot = () => ({
  generatedAt: '2026-09-26T00:00:00Z', chamber: 'U.S. HOUSE', sourceLabel: 'House Clerk',
  rollCalls: [{ id: 'house-2026-314', bill: 'S. 2403', title: 'Example official title', kind: 'substantive', outcome: 'Passed', date: '2026-09-16', sourceUrl: 'https://clerk.house.gov/Votes/2026314', votes: { X000001: 'yes' } }],
});

test('present, not voting and unsupported positions stay distinct', () => {
  assert.equal(federalVote('Present'), 'present');
  assert.equal(federalVote('Not Voting'), 'absent');
  assert.equal(federalVote('Yea'), 'yes');
  assert.equal(federalVote('Nay'), 'no');
  assert.throws(() => federalVote('Unexpected source value'));
  assert.equal(classifyMark('ER'), 'absent');
  assert.equal(classifyMark('Unknown'), null);
});
test('CLI bounds reject accidental destructive empty imports', () => {
  for (const value of ['0', '-1', 'NaN', '1.5', undefined]) assert.throws(() => positiveCount(['--count', value], '--count', 150));
  assert.equal(positiveCount([], '--count', 150), 150);
});
test('nested Senate question XML becomes readable without losing amendment number', () => {
  assert.equal(decodeXml('On the Amendment <measure>S.Amdt. 6776</measure> &amp; &#160; related'), 'On the Amendment S.Amdt. 6776 & related');
});
test('reject invalid, duplicate and future records before publication', () => {
  const empty = snapshot(); empty.rollCalls = []; assert.throws(() => validateSnapshot(empty));
  const duplicate = snapshot(); duplicate.rollCalls.push(duplicate.rollCalls[0]); assert.throws(() => validateSnapshot(duplicate));
  const invalid = snapshot(); invalid.rollCalls[0].date = '2026-02-30'; assert.throws(() => validateSnapshot(invalid));
  const future = snapshot(); future.rollCalls[0].date = '2026-10-01'; assert.throws(() => validateSnapshot(future));
  const source = snapshot(); source.rollCalls[0].sourceUrl = 'https://example.org'; assert.throws(() => validateSnapshot(source));
});
test('failed refresh preserves working file and successful refresh retains summary provenance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fullrecord-ingest-'));
  const path = join(directory, 'snapshot.json');
  try {
    const previous = snapshot(); previous.rollCalls[0].summary = 'Official summary'; previous.rollCalls[0].summarySource = 'official';
    await writeFile(path, JSON.stringify(previous));
    await assert.rejects(writeSnapshot(path, { ...snapshot(), rollCalls: [] }));
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), previous);
    await writeSnapshot(path, snapshot());
    const result = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(result.rollCalls[0].summary, 'Official summary');
    assert.equal(result.rollCalls[0].summarySource, 'official');
  } finally { await rm(directory, { recursive: true }); }
});
