const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  rejectSecretKeys,
  redactSecretKeys,
  SECRET_KEY_PATTERN,
} = require('../src/middleware/rejectSecretKeys');

// A syntactically valid-shaped Stellar secret (never a real key).
const FAKE_SECRET = 'S' + 'A'.repeat(55);

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function runMiddleware(body, query = {}) {
  const req = { body, query };
  const res = mockRes();
  let nextCalled = false;
  rejectSecretKeys(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

// rejectSecretKeys -----------------------------------------------------------

test('rejectSecretKeys: allows ordinary deal payloads', () => {
  const { nextCalled, res } = runMiddleware({
    seller: 'G' + 'B'.repeat(55),
    amount: 100,
    description: 'widgets',
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('rejectSecretKeys: rejects a top-level buyerSecret field', () => {
  const { nextCalled, res } = runMiddleware({
    seller: 'G' + 'B'.repeat(55),
    amount: 1,
    description: 'x',
    buyerSecret: FAKE_SECRET,
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /never be sent to the server/i);
});

test('rejectSecretKeys: rejects secrets nested in objects and arrays', () => {
  assert.equal(runMiddleware({ nested: { key: FAKE_SECRET } }).nextCalled, false);
  assert.equal(runMiddleware({ items: [{ secret: FAKE_SECRET }] }).nextCalled, false);
  assert.equal(runMiddleware({ list: [FAKE_SECRET] }).nextCalled, false);
});

test('rejectSecretKeys: rejects a secret embedded in a longer string', () => {
  const { nextCalled } = runMiddleware({ note: `please use ${FAKE_SECRET} to lock` });
  assert.equal(nextCalled, false);
});

test('rejectSecretKeys: rejects secrets in the query string', () => {
  const req = { body: {}, query: { amount: FAKE_SECRET } };
  const res = mockRes();
  let nextCalled = false;
  rejectSecretKeys(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
});

test('rejectSecretKeys: does not treat a public key as a secret', () => {
  // G-prefixed keys must not trip the S[A-Z2-7]{55} pattern.
  const { nextCalled } = runMiddleware({ wallet: 'G' + 'B'.repeat(55) });
  assert.equal(nextCalled, true);
});

// redactSecretKeys -----------------------------------------------------------

test('redactSecretKeys: replaces secret-key shaped substrings', () => {
  const out = redactSecretKeys(`lock failed for ${FAKE_SECRET} at step 2`);
  assert.equal(out.includes(FAKE_SECRET), false);
  assert.match(out, /\[REDACTED_STELLAR_SECRET\]/);
});

test('redactSecretKeys: leaves ordinary strings alone', () => {
  assert.equal(redactSecretKeys('deal not found'), 'deal not found');
});

test('redactSecretKeys: passes through non-strings', () => {
  assert.equal(redactSecretKeys(undefined), undefined);
  assert.equal(redactSecretKeys(42), 42);
});

// pattern --------------------------------------------------------------------

test('SECRET_KEY_PATTERN matches S-keys and not G-keys', () => {
  assert.ok(SECRET_KEY_PATTERN.test(FAKE_SECRET));
  assert.equal(SECRET_KEY_PATTERN.test('G' + 'B'.repeat(55)), false);
});
