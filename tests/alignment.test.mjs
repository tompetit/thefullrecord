import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignmentRace, alphabetical, compareCandidate, compareCandidates, compareIssue,
  countsSentence, parseStand, serializeStand, withStand,
} from '../src/lib/alignment.ts';
import { ISSUES } from '../src/server/guide/types.ts';

const KEYS = Object.keys(ISSUES);
const pos = (issue, stance, extra = {}) => ({ issue, stance, summary: `${issue} ${stance}`, sources: ['s1'], ...extra });

test('stand param: valid pairs parse into canonical ISSUES order', () => {
  assert.deepEqual(parseStand('rent_regulation:agree,guns:disagree', KEYS), [
    { issue: 'guns', answer: 'disagree' },
    { issue: 'rent_regulation', answer: 'agree' },
  ]);
  assert.equal(serializeStand(parseStand('rent_regulation:agree,guns:disagree', KEYS)), 'guns:disagree,rent_regulation:agree');
});

test('stand param: unknown issues, skips, bad answers, malformed and duplicate pairs are dropped', () => {
  assert.deepEqual(parseStand('bogus:agree,guns:maybe,climate:skip,abortion,tariffs:agree:x,:agree', KEYS), []);
  assert.deepEqual(parseStand('guns:disagree,guns:agree', KEYS), [{ issue: 'guns', answer: 'disagree' }]);
  assert.deepEqual(parseStand(' guns:agree ', KEYS), [{ issue: 'guns', answer: 'agree' }]);
  assert.deepEqual(parseStand('GUNS:AGREE', KEYS), []);
  assert.deepEqual(parseStand('__proto__:agree,constructor:agree', KEYS), []);
  assert.deepEqual(parseStand('', KEYS), []);
  assert.deepEqual(parseStand(undefined, KEYS), []);
  assert.deepEqual(parseStand(['guns:agree', 'climate:agree'], KEYS), [{ issue: 'guns', answer: 'agree' }]);
  assert.deepEqual(parseStand('guns:agree', ['climate']), []);
});

test('each comparison outcome follows the documented stance relative to the statement', () => {
  assert.equal(compareIssue(pos('guns', 'supports'), 'agree'), 'same');
  assert.equal(compareIssue(pos('guns', 'opposes'), 'disagree'), 'same');
  assert.equal(compareIssue(pos('guns', 'supports'), 'disagree'), 'different');
  assert.equal(compareIssue(pos('guns', 'opposes'), 'agree'), 'different');
  assert.equal(compareIssue(pos('guns', 'mixed'), 'agree'), 'mixed');
  assert.equal(compareIssue(pos('guns', 'mixed'), 'disagree'), 'mixed');
  assert.equal(compareIssue(undefined, 'agree'), 'none');
});

test('vote-based and not_inferred positions are shown but never given a direction or counted as same/different', () => {
  const votes = pos('guns', 'not_inferred', { basis: 'votes', stated: { stance: 'supports', summary: 'said', sources: ['s2'] } });
  assert.equal(compareIssue(votes, 'agree'), 'not_inferred');
  // Even if a vote-based entry somehow carried a direction, it is not compared.
  assert.equal(compareIssue(pos('guns', 'supports', { basis: 'votes' }), 'agree'), 'not_inferred');
  assert.equal(compareIssue(pos('guns', 'not_inferred'), 'disagree'), 'not_inferred');
  const { items, counts } = compareCandidate([votes], [{ issue: 'guns', answer: 'agree' }]);
  assert.equal(items[0].basis, 'votes');
  assert.equal(items[0].position, votes);
  assert.deepEqual(counts, { answered: 1, same: 0, different: 0, mixed: 0, notInferred: 1, none: 0 });
});

test('counts are plain facts and the sentence carries no percentage or rating', () => {
  const positions = [pos('abortion', 'supports'), pos('guns', 'opposes'), pos('climate', 'mixed'), pos('tariffs', 'supports')];
  const stand = parseStand('abortion:agree,guns:agree,climate:agree,tariffs:agree,minimum_wage:disagree', KEYS);
  const { items, counts } = compareCandidate(positions, stand);
  assert.deepEqual(items.map((i) => [i.issue, i.outcome, i.basis]), [
    ['abortion', 'same', 'statements'],
    ['guns', 'different', 'statements'],
    ['climate', 'mixed', 'statements'],
    ['minimum_wage', 'none', undefined],
    ['tariffs', 'same', 'statements'],
  ]);
  const sentence = countsSentence(counts);
  assert.equal(sentence, 'Same on 2 · Different on 1 · Mixed 1 · No record 1 of the 5 topics you answered');
  assert.doesNotMatch(sentence, /%|score|match|best|rank/i);
  assert.match(countsSentence({ answered: 1, same: 0, different: 0, mixed: 0, notInferred: 1, none: 0 }), /Votes only, not compared 1 · No record 0 of the 1 topic you answered/);
});

test('output order equals input (alphabetical) order, never alignment order', () => {
  const candidates = alphabetical([
    { name: 'Zed Adams', positions: [pos('guns', 'supports')] },
    { name: 'Ann Brown', positions: [pos('guns', 'opposes')] },
    { name: 'Mo Chen', positions: [] },
  ]);
  assert.deepEqual(candidates.map((c) => c.name), ['Ann Brown', 'Mo Chen', 'Zed Adams']);
  const out = compareCandidates(candidates, [{ issue: 'guns', answer: 'agree' }]);
  assert.deepEqual(out.map((r) => r.candidate.name), ['Ann Brown', 'Mo Chen', 'Zed Adams']);
  assert.deepEqual(out.map((r) => r.items[0].outcome), ['different', 'none', 'same']);
});

test('withStand preserves other params and hashes, and removes an empty stand', () => {
  assert.equal(withStand('/guide/race/ny-ad-73', 'guns:agree,climate:disagree'), '/guide/race/ny-ad-73?stand=guns:agree,climate:disagree');
  assert.equal(withStand('/guide/match?address=350+5th+Ave&stand=old:agree#r', 'guns:agree'), '/guide/match?address=350+5th+Ave&stand=guns:agree#r');
  assert.equal(withStand('/guide/race/x?stand=guns:agree', ''), '/guide/race/x');
});

test('alignmentRace keeps citation numbering and alphabetical candidates', () => {
  const race = {
    id: 'r', title: 'R', sources: [{ id: 's0', url: 'u0', title: 't0', publisher: 'p', kind: 'news' }, { id: 's1', url: 'u1', title: 't1', publisher: 'p', kind: 'official' }],
    candidates: [{ id: 'b', name: 'B', parties: [], positions: [pos('guns', 'supports')] }, { id: 'a', name: 'A', parties: [], positions: [] }],
  };
  const slim = alignmentRace(race);
  assert.deepEqual(slim.sources.map((s) => [s.id, s.url]), [['s0', ''], ['s1', 'u1']]);
  assert.deepEqual(slim.candidates.map((c) => c.id), ['a', 'b']);
});
