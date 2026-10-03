import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignmentRace, alphabetical, compareCandidate, compareCandidates, compareIssue, compareVote,
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
  assert.equal(compareIssue('supports', 'agree'), 'same');
  assert.equal(compareIssue('opposes', 'disagree'), 'same');
  assert.equal(compareIssue('supports', 'disagree'), 'different');
  assert.equal(compareIssue('opposes', 'agree'), 'different');
  assert.equal(compareIssue('mixed', 'agree'), 'mixed');
  assert.equal(compareIssue('mixed', 'disagree'), 'mixed');
  assert.equal(compareIssue('not_inferred', 'agree'), 'none');
  assert.equal(compareIssue(undefined, 'agree'), 'none');
});

test('each recorded vote is compared on its own, using which way a Yes points', () => {
  const v = (vote, yesMeans) => ({ text: 't', vote, yesMeans, sources: ['k'] });
  assert.equal(compareVote(v('yes', 'supports'), 'agree'), 'in_line');
  assert.equal(compareVote(v('no', 'supports'), 'agree'), 'not_in_line');
  assert.equal(compareVote(v('yes', 'opposes'), 'agree'), 'not_in_line');
  assert.equal(compareVote(v('no', 'opposes'), 'agree'), 'in_line');
  assert.equal(compareVote(v('yes', 'supports'), 'disagree'), 'not_in_line');
  assert.equal(compareVote(v('no', 'opposes'), 'disagree'), 'not_in_line');
  // No direction recorded by the editors -> shown, never compared.
  assert.equal(compareVote(v('yes', undefined), 'agree'), 'not_compared');
});

test('an incumbent is compared on statements AND on each vote, kept apart, with no stance inferred from votes', () => {
  const votesPos = pos('guns', 'not_inferred', {
    basis: 'votes',
    stated: { stance: 'supports', summary: 'said', sources: ['s2'] },
    votes: [
      { text: 'Voted yes on A', vote: 'yes', yesMeans: 'supports', sources: ['k1'] },
      { text: 'Voted yes on B', vote: 'yes', yesMeans: 'opposes', sources: ['k2'] },
      { text: 'Voted no on C', vote: 'no', sources: ['k3'] },
    ],
  });
  const { items, counts } = compareCandidate([votesPos], [{ issue: 'guns', answer: 'agree' }]);
  assert.equal(items[0].outcome, 'same'); // from the statement only
  assert.equal(items[0].statement.summary, 'said');
  assert.deepEqual(items[0].votes.map((x) => x.match), ['in_line', 'not_in_line', 'not_compared']);
  assert.deepEqual(counts, { answered: 1, same: 1, different: 0, mixed: 0, votesOnly: 0, none: 0, votesInLine: 1, votesNotInLine: 1 });
  // Votes without any statement: no topic verdict, only per-vote results.
  const onlyVotes = pos('guns', 'not_inferred', { basis: 'votes', votes: votesPos.votes });
  const r = compareCandidate([onlyVotes], [{ issue: 'guns', answer: 'disagree' }]);
  assert.equal(r.items[0].outcome, 'votes_only');
  assert.equal(r.items[0].statement, undefined);
  assert.equal(r.counts.same + r.counts.different, 0);
});

test('counts are plain facts and the sentence carries no percentage or rating', () => {
  const positions = [pos('abortion', 'supports'), pos('guns', 'opposes'), pos('climate', 'mixed'), pos('tariffs', 'supports')];
  const stand = parseStand('abortion:agree,guns:agree,climate:agree,tariffs:agree,minimum_wage:disagree', KEYS);
  const { items, counts } = compareCandidate(positions, stand);
  assert.deepEqual(items.map((i) => [i.issue, i.outcome]), [
    ['abortion', 'same'],
    ['guns', 'different'],
    ['climate', 'mixed'],
    ['minimum_wage', 'none'],
    ['tariffs', 'same'],
  ]);
  const sentence = countsSentence(counts);
  assert.equal(sentence, 'Statements: same as you on 2, different on 1, mixed on 1 · No record on 1 of the 5 topics you answered');
  assert.doesNotMatch(sentence, /%|score|match|best|rank/i);
  assert.equal(
    countsSentence({ answered: 2, same: 0, different: 0, mixed: 0, votesOnly: 1, none: 1, votesInLine: 1, votesNotInLine: 2 }),
    'Statements: same as you on 0, different on 0 · Recorded votes: 1 vote in line with your answers, 2 not · No record on 1 of the 2 topics you answered',
  );
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
