const assert = require('node:assert/strict');
const { test } = require('node:test');
const { canTransition } = require('../src/services/dealStateMachine');

const BASE = 'http://localhost:3000/api';
const MISSING_UUID = '00000000-0000-4000-8000-000000000000';

// ── Auth guards ─────────────────────────────────────────────────────────────

test('POST /api/fiat/initiate returns 401 without Authorization header', async () => {
  const res = await fetch(`${BASE}/fiat/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dealId: MISSING_UUID, amountFiat: 10, currency: 'USD' }),
  });
  assert.equal(res.status, 401);
});

test('GET /api/fiat/:id returns 401 without Authorization header', async () => {
  const res = await fetch(`${BASE}/fiat/${MISSING_UUID}`);
  assert.equal(res.status, 401);
});

// ── Validation ──────────────────────────────────────────────────────────────

test('POST /api/fiat/initiate returns 400 with missing dealId', async () => {
  const res = await fetch(`${BASE}/fiat/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer fake-token',
    },
    body: JSON.stringify({ amountFiat: 10 }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/fiat/initiate returns 400 with missing amountFiat', async () => {
  const res = await fetch(`${BASE}/fiat/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer fake-token',
    },
    body: JSON.stringify({ dealId: MISSING_UUID }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/fiat/initiate returns 400 with negative amountFiat', async () => {
  const res = await fetch(`${BASE}/fiat/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer fake-token',
    },
    body: JSON.stringify({ dealId: MISSING_UUID, amountFiat: -5 }),
  });
  assert.equal(res.status, 400);
});

// ── Webhook ─────────────────────────────────────────────────────────────────

test('POST /api/fiat/webhook/transak returns 200 for unknown events', async () => {
  const res = await fetch(`${BASE}/fiat/webhook/transak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventName: 'UNKNOWN_EVENT', data: {} }),
  });
  assert.equal(res.status, 200);
});

test('POST /api/fiat/webhook/transak returns 200 for successful event with no matching deal', async () => {
  const res = await fetch(`${BASE}/fiat/webhook/transak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventName: 'TRANSAK_ORDER_SUCCESSFUL',
      data: { partnerOrderId: MISSING_UUID, id: 'tsk_test_123' },
    }),
  });
  assert.equal(res.status, 200);
});

test('POST /api/fiat/webhook/transak returns 200 for failed event with no matching deal', async () => {
  const res = await fetch(`${BASE}/fiat/webhook/transak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventName: 'TRANSAK_ORDER_FAILED',
      data: { partnerOrderId: MISSING_UUID },
    }),
  });
  assert.equal(res.status, 200);
});

// ── State machine ───────────────────────────────────────────────────────────

test('Deal state machine allows created -> fiat_pending transition', () => {
  assert.ok(canTransition('created', 'fiat_pending'));
});

test('Deal state machine allows fiat_pending -> fiat_locked transition', () => {
  assert.ok(canTransition('fiat_pending', 'fiat_locked'));
});

test('Deal state machine allows fiat_pending -> created fallback', () => {
  assert.ok(canTransition('fiat_pending', 'created'));
});

test('Deal state machine allows fiat_locked -> shipped transition', () => {
  assert.ok(canTransition('fiat_locked', 'shipped'));
});

test('Deal state machine does NOT allow fiat_locked -> confirming', () => {
  assert.ok(!canTransition('fiat_locked', 'confirming'));
});

test('Deal state machine does NOT allow locked -> fiat_pending', () => {
  assert.ok(!canTransition('locked', 'fiat_pending'));
});

test('Deal state machine does NOT allow shipped -> fiat_pending', () => {
  assert.ok(!canTransition('shipped', 'fiat_pending'));
});
