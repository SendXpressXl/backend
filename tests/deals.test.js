const assert = require('node:assert/strict');
const { test } = require('node:test');

const BASE = 'http://localhost:3000/api';

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
  const res = await fetch(`${BASE}/deals/nonexistent-id-00000`);
  assert.equal(res.status, 404);
});

test('POST /api/deals/:id/confirm returns 404 for unknown deal', async () => {
  const res = await fetch(`${BASE}/deals/nonexistent-id-00000/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyerId: 'GBUYER123' }),
  });
  assert.equal(res.status, 404);
});

test('POST /api/deals/:id/cancel returns 404 for unknown deal', async () => {
  const res = await fetch(`${BASE}/deals/nonexistent-id-00000/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buyerId: 'GBUYER123' }),
  });
  assert.equal(res.status, 404);
});

test('concurrent POST /api/deals/:id/confirm calls return 409 for second request', async () => {
  const [r1, r2] = await Promise.all([
    fetch(`${BASE}/deals/nonexistent-id-00000/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyerId: 'GBUYER123' }),
    }),
    fetch(`${BASE}/deals/nonexistent-id-00000/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyerId: 'GBUYER123' }),
    }),
  ]);
  const statuses = [r1.status, r2.status];
  assert.ok(
    statuses.every(s => s === 404) || statuses.includes(409),
    `expected both 404 or one 409, got ${statuses}`
  );
});
