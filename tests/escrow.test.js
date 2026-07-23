const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { dealMemo, formatAmount } = require('../src/services/escrow');

const DEAL_ID = 'a1b2c3d4-e5f6-4789-a012-3456789abcde'; // 36 bytes — over the 28-byte MEMO_TEXT limit

test('dealMemo builds a 32-byte MEMO_HASH from the deal id', () => {
  const memo = dealMemo(DEAL_ID);
  assert.equal(memo.type, 'hash');
  assert.equal(memo.value.length, 32);
});

test('dealMemo is deterministic for the same deal id', () => {
  assert.deepEqual(dealMemo(DEAL_ID).value, dealMemo(DEAL_ID).value);
});

test('dealMemo differs between deal ids', () => {
  const other = 'ffffffff-ffff-4fff-afff-ffffffffffff';
  assert.notDeepEqual(dealMemo(DEAL_ID).value, dealMemo(other).value);
});

test('dealMemo matches a plain sha256 digest of the deal id', () => {
  const expected = crypto.createHash('sha256').update(DEAL_ID).digest();
  assert.deepEqual(dealMemo(DEAL_ID).value, expected);
});

test('a UUID-based memo no longer throws (regression check for the old Memo.text bug)', () => {
  assert.doesNotThrow(() => dealMemo(DEAL_ID));
});

test('formatAmount matches how Stellar amounts round-trip through XDR', () => {
  // Regression check: a payment built with amount "100" reads back off the
  // chain as "100.0000000". Comparing against a bare String(amount) instead
  // of this format flags every real transaction as a mismatch.
  assert.equal(formatAmount(100), '100.0000000');
  assert.equal(formatAmount('100'), '100.0000000');
  assert.equal(formatAmount(100.5), '100.5000000');
  assert.equal(formatAmount('99.1234567'), '99.1234567');
});
