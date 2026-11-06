import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCandidate, toResult } from '../scripts/guide/results.mjs';

const race = { candidates: [{ id: 'clayton-fuller', name: 'Clayton Fuller' }, { id: 'a-smith', name: 'Ann Smith' }, { id: 'b-smith', name: 'Bob Smith Jr.' }] };

test('names match on surname, preferring the same first initial', () => {
  assert.equal(matchCandidate(race.candidates, 'Clay Fuller').id, 'clayton-fuller');
  assert.equal(matchCandidate(race.candidates, 'Bob Smith').id, 'b-smith');
  assert.equal(matchCandidate(race.candidates, 'Nobody Else'), null);
});

test('a called winner is projected; no winner or an unlisted winner stays uncalled', () => {
  const feed = (name, isWinner) => ({ percentIn: 90, candidates: [{ name, isWinner, votes: 10, percentVote: 60 }] });
  assert.deepEqual(toResult(race, feed('Clay Fuller', true), 'u').winner, 'clayton-fuller');
  assert.equal(toResult(race, feed('Clay Fuller', false), 'u').status, 'uncalled');
  assert.equal(toResult(race, feed('Nobody Else', true), 'u').status, 'uncalled');
});
