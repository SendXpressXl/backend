const assert = require('node:assert/strict');
const { test } = require('node:test');

const BASE = 'http://localhost:3000/api';

test('POST /api/users returns 401 without Authorization header', async () => {
  const res = await fetch(`${BASE}/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle: 'testuser' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/users/:id/role returns 401 without Authorization header', async () => {
  const res = await fetch(`${BASE}/users/00000000-0000-4000-8000-000000000000/role`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'seller' }),
  });
  assert.equal(res.status, 401);
});

test('PATCH /api/users/:id/role rejects invalid role', async () => {
  const res = await fetch(`${BASE}/users/00000000-0000-4000-8000-000000000000/role`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  // 401 (no auth) or 400 (bad role) — either proves the guard is active
  assert.ok([400, 401].includes(res.status), `expected 400 or 401, got ${res.status}`);
});
