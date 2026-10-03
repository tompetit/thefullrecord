import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, errorCodeOf } from '../scripts/guide/link-classify.mjs';

test('2xx and 3xx are ok', () => {
  for (const s of [200, 204, 301, 302, 399]) assert.equal(classify({ httpStatus: s }), 'ok');
});
test('404 and 410 are dead', () => {
  assert.equal(classify({ httpStatus: 404 }), 'dead');
  assert.equal(classify({ httpStatus: 410 }), 'dead');
});
test('bot-blocking and server errors are inconclusive, never dead', () => {
  for (const s of [400, 401, 403, 405, 429, 500, 502, 503, 999]) assert.equal(classify({ httpStatus: s }), 'inconclusive');
});
test('DNS failure and refused connection are dead', () => {
  assert.equal(classify({ errorCode: 'ENOTFOUND' }), 'dead');
  assert.equal(classify({ errorCode: 'ECONNREFUSED' }), 'dead');
});
test('timeouts and other network errors are inconclusive', () => {
  for (const c of ['TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'CERT_HAS_EXPIRED', 'UNKNOWN', undefined]) assert.equal(classify({ errorCode: c }), 'inconclusive');
  assert.equal(classify({}), 'inconclusive');
});
test('errorCodeOf unwraps fetch causes', () => {
  assert.equal(errorCodeOf(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })), 'ENOTFOUND');
  assert.equal(errorCodeOf(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'TIMEOUT');
  assert.equal(errorCodeOf(new Error('x')), 'UNKNOWN');
});
