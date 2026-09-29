import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAllRaces, buildIndex } from '../../src/server/guide/load.ts';

test('every authored and generated vote-evidence position avoids inferred ideology', () => {
  const races = getAllRaces();
  assert.ok(races.length > 0);
  let count = 0;
  let noVotes = 0;
  for (const race of races) for (const candidate of race.candidates) for (const position of candidate.positions) {
    if (position.basis !== 'votes') continue;
    count++;
    assert.equal(position.stance, 'not_inferred', `${race.id}/${candidate.id}/${position.issue}`);
    assert.ok(position.summary.length > 0);
    assert.ok(position.sources.length > 0);
    if (/voted no/i.test(position.summary)) noVotes++;
  }
  assert.ok(count > 50, 'regression test covers the full researched guide');
  assert.ok(noVotes > 0, 'no votes remain visible as evidence');
});

test('search index retains non-inferred marker instead of resurrecting broad stance', () => {
  const races = getAllRaces();
  const index = buildIndex(races);
  for (const race of races) for (const candidate of race.candidates) for (const position of candidate.positions) {
    if (position.basis !== 'votes') continue;
    const indexed = index.find(r => r.id === race.id)?.candidates.find(c => c.id === candidate.id);
    assert.equal(indexed?.positions[position.issue], 'not_inferred');
  }
});

test('opposing an omnibus bill does not imply an opposite stance on every provision', () => {
  const omnibusVoteIds = new Set(['h-2025-145', 'h-2025-190', 's-2025-372']);
  const issues = ['healthcare_public', 'immigration_enforcement', 'climate', 'tax_wealthy'];
  let candidatesChecked = 0;
  for (const race of getAllRaces()) for (const candidate of race.candidates) {
    if (!candidate.keyVotes?.some(vote => omnibusVoteIds.has(vote.voteId) && vote.vote === 'no')) continue;
    candidatesChecked++;
    for (const issue of issues) {
      const position = candidate.positions.find(p => p.issue === issue);
      assert.equal(position?.stance, 'not_inferred', `${candidate.name}: ${issue}`);
      assert.match(position.summary, /Voted no/);
      assert.equal(position.basis, 'votes');
    }
  }
  assert.ok(candidatesChecked > 0);
});
