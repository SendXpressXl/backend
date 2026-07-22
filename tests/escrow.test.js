const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { dealMemo } = require('../src/services/escrow');

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
