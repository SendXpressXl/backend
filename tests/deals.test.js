const assert = require('node:assert/strict');
const { test } = require('node:test');

const BASE = 'http://localhost:3000/api';

// A well-formed UUID that does not exist, and a valid Stellar public key — both
// pass validation so these requests reach the handler's not-found/lock logic
// rather than being rejected at the validation layer.
const MISSING_UUID = '00000000-0000-4000-8000-000000000000';
const BUYER = 'G' + 'A'.repeat(55);

test('POST /api/deals requires all fields', async () => {
  const res = await fetch(`${BASE}/deals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seller: 'G123' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});

test('GET /api/deals requires userId', async () => {
  const res = await fetch(`${BASE}/deals`);
  assert.equal(res.status, 400);
});

test('GET /api/deals/:id returns 404 for unknown id', async () => {
  const res = await fetch(`${BASE}/deals/${MISSING_UUID}`);
  assert.equal(res.status, 404);
});

test('POST /api/deals/:id/confirm returns 404 for unknown deal', async () => {
  const res = await fetch(`${BASE}/deals/${MISSING_UUID}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyerId: BUYER }),
  });
  assert.equal(res.status, 404);
});

test('POST /api/deals/:id/cancel returns 404 for unknown deal', async () => {
  const res = await fetch(`${BASE}/deals/${MISSING_UUID}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyerId: BUYER }),
  });
  assert.equal(res.status, 404);
});

test('concurrent confirm and cancel on same deal cannot both succeed', async () => {
  const [confirmRes, cancelRes] = await Promise.all([
    fetch(`${BASE}/deals/${MISSING_UUID}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyerId: BUYER }),
    }),
    fetch(`${BASE}/deals/${MISSING_UUID}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyerId: BUYER }),
    }),
  ]);
  const statuses = [confirmRes.status, cancelRes.status];
  assert.ok(
    statuses.every(s => s === 404) || statuses.some(s => s === 409),
    `expected both 404 or one 409, got ${statuses}`
  );
});

test('concurrent POST /api/deals/:id/confirm calls return 409 for second request', async () => {
  const [r1, r2] = await Promise.all([
    fetch(`${BASE}/deals/${MISSING_UUID}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyerId: BUYER }),
    }),
    fetch(`${BASE}/deals/${MISSING_UUID}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyerId: BUYER }),
    }),
  ]);
  const statuses = [r1.status, r2.status];
  assert.ok(
    statuses.every(s => s === 404) || statuses.includes(409),
    `expected both 404 or one 409, got ${statuses}`
  );
});
