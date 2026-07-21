const assert = require('node:assert/strict');
const { test } = require('node:test');
const { canTransition } = require('../src/services/dealStateMachine');

test('created can move to locking, cancelling, or disputed', () => {
  assert.equal(canTransition('created', 'locking'), true);
  assert.equal(canTransition('created', 'cancelling'), true);
  assert.equal(canTransition('created', 'disputed'), true);
});

test('shipping requires locked, not created', () => {
  // Regression check for the bug where /ship accepted status "created".
  assert.equal(canTransition('locked', 'shipped'), true);
  assert.equal(canTransition('created', 'shipped'), false);
});

test('shipped can move to confirming, disputed, or expired', () => {
  assert.equal(canTransition('shipped', 'confirming'), true);
  assert.equal(canTransition('shipped', 'disputed'), true);
  assert.equal(canTransition('shipped', 'expired'), true);
});

test('terminal statuses have no outgoing transitions', () => {
  for (const status of ['confirmed', 'cancelled', 'disputed', 'expired']) {
    assert.equal(canTransition(status, 'locking'), false);
    assert.equal(canTransition(status, 'shipped'), false);
  }
});

test('unknown statuses transition to nothing', () => {
  assert.equal(canTransition('made-up-status', 'shipped'), false);
});
