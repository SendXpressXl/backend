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

async function createSellerListing(token) {
  const res = await fetch(`${BASE}/listings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ title: 'Seller listing', price: 100 }),
  });
  if (res.status !== 201) return null;
  return (await res.json()).id;
}

test('POST /api/chat/conversations returns 400 when seller omits buyer_id', async () => {
  const token = process.env.TEST_SESSION_TOKEN;
  if (!token) { console.log('  skip: TEST_SESSION_TOKEN not set'); return; }
  const listingId = await createSellerListing(token);
  if (!listingId) { console.log('  skip: could not create listing'); return; }
  const res = await fetch(`${BASE}/chat/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ listing_id: listingId }),
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.error, 'buyer_id is required when creating as seller');
});

test('POST /api/chat/messages returns 404 for non-existent conversation', async () => {
  const token = process.env.TEST_SESSION_TOKEN;
  if (!token) { console.log('  skip: TEST_SESSION_TOKEN not set'); return; }
  const res = await fetch(`${BASE}/chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ conversation_id: MISSING_UUID, body: 'hello' }),
  });
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.error, 'Conversation not found');
});

test('POST /api/chat/conversations creates conversation when seller provides buyer_id', async () => {
  const token = process.env.TEST_SESSION_TOKEN;
  if (!token) { console.log('  skip: TEST_SESSION_TOKEN not set'); return; }
  const listingId = await createSellerListing(token);
  if (!listingId) { console.log('  skip: could not create listing'); return; }
  const res = await fetch(`${BASE}/chat/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ listing_id: listingId, buyer_id: MISSING_UUID }),
  });
  assert.ok([200, 201].includes(res.status), `expected 200 or 201, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.listing_id, listingId);
});

test('POST /api/chat/conversations is idempotent for the same listing/buyer/seller triple', async () => {
  const token = process.env.TEST_SESSION_TOKEN;
  if (!token) { console.log('  skip: TEST_SESSION_TOKEN not set'); return; }
  const listingId = await createSellerListing(token);
  if (!listingId) { console.log('  skip: could not create listing'); return; }

  const create = () => fetch(`${BASE}/chat/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ listing_id: listingId, buyer_id: MISSING_UUID }),
  });

  const first  = await (await create()).json();
  const second = await (await create()).json();

  // Same triple twice should resolve to the same row, not a duplicate —
  // this is the race the unique constraint + upsert closes.
  assert.equal(second.id, first.id);
});

test('GET /api/chat/messages returns the paginated shape', async () => {
  const token = process.env.TEST_SESSION_TOKEN;
  if (!token) { console.log('  skip: TEST_SESSION_TOKEN not set'); return; }
  const listingId = await createSellerListing(token);
  if (!listingId) { console.log('  skip: could not create listing'); return; }

  const conv = await (await fetch(`${BASE}/chat/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ listing_id: listingId, buyer_id: MISSING_UUID }),
  })).json();

  for (const body of ['first', 'second', 'third']) {
    await fetch(`${BASE}/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ conversation_id: conv.id, body }),
    });
  }

  const res = await fetch(`${BASE}/chat/messages?conversationId=${conv.id}&limit=2`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const page = await res.json();
  assert.ok(Array.isArray(page.messages), 'messages should be an array');
  assert.ok(page.messages.length <= 2, 'should respect the limit');
  assert.equal(typeof page.hasMore, 'boolean');
  if (page.hasMore) assert.ok(page.nextCursor, 'nextCursor should be set when hasMore is true');
});
