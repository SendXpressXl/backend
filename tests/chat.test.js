const assert = require('node:assert/strict');
const { test } = require('node:test');

const BASE = 'http://localhost:3000/api';

const MISSING_UUID = '00000000-0000-4000-8000-000000000000';

test('GET /api/chat/conversations returns 401 without Authorization header', async () => {
  const res = await fetch(`${BASE}/chat/conversations`);
  assert.equal(res.status, 401);
});

test('POST /api/chat/conversations returns 401 without Authorization header', async () => {
  const res = await fetch(`${BASE}/chat/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listing_id: MISSING_UUID }),
  });
  assert.equal(res.status, 401);
});

test('GET /api/chat/messages returns 401 without Authorization header', async () => {
  const res = await fetch(`${BASE}/chat/messages?conversationId=${MISSING_UUID}`);
  assert.equal(res.status, 401);
});

test('POST /api/chat/messages returns 401 without Authorization header', async () => {
  const res = await fetch(`${BASE}/chat/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: MISSING_UUID, body: 'hello' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/chat/messages requires conversation_id', async () => {
  const token = process.env.TEST_SESSION_TOKEN;
  if (!token) { console.log('  skip: TEST_SESSION_TOKEN not set'); return; }
  const res = await fetch(`${BASE}/chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ body: 'hello' }),
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
});

test('POST /api/chat/messages rejects empty body', async () => {
  const token = process.env.TEST_SESSION_TOKEN;
  if (!token) { console.log('  skip: TEST_SESSION_TOKEN not set'); return; }
  const res = await fetch(`${BASE}/chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ conversation_id: MISSING_UUID, body: '' }),
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
});

test('POST /api/chat/conversations requires listing_id', async () => {
  const token = process.env.TEST_SESSION_TOKEN;
  if (!token) { console.log('  skip: TEST_SESSION_TOKEN not set'); return; }
  const res = await fetch(`${BASE}/chat/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
});

test('POST /api/chat/conversations returns 404 for nonexistent listing', async () => {
  const token = process.env.TEST_SESSION_TOKEN;
  if (!token) { console.log('  skip: TEST_SESSION_TOKEN not set'); return; }
  const res = await fetch(`${BASE}/chat/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ listing_id: MISSING_UUID }),
  });
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
});
