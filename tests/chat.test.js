const assert = require('node:assert/strict');
const { test } = require('node:test');

const BASE = 'http://localhost:3000/api';

test('GET /api/chat/conversations returns 401 without Authorization header', async () => {
  const res = await fetch(`${BASE}/chat/conversations`);
  assert.equal(res.status, 401);
});

test('POST /api/chat/conversations returns 401 without Authorization header', async () => {
  const res = await fetch(`${BASE}/chat/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listing_id: '00000000-0000-4000-8000-000000000000', buyer_id: '00000000-0000-4000-8000-000000000001', seller_id: '00000000-0000-4000-8000-000000000002' }),
  });
  assert.equal(res.status, 401);
});

test('GET /api/chat/messages returns 401 without Authorization header', async () => {
  const res = await fetch(`${BASE}/chat/messages?conversationId=00000000-0000-4000-8000-000000000000`);
  assert.equal(res.status, 401);
});

test('POST /api/chat/messages returns 401 without Authorization header', async () => {
  const res = await fetch(`${BASE}/chat/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: '00000000-0000-4000-8000-000000000000', sender_id: '00000000-0000-4000-8000-000000000001', body: 'hello' }),
  });
  assert.equal(res.status, 401);
});
