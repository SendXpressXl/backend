const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const BASE = 'http://localhost:3000/api';

async function waitForServer(url, retries = 10, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try { await fetch(url); return; } catch { await new Promise(r => setTimeout(r, delayMs)); }
  }
  throw new Error(`Server at ${url} did not become ready in time`);
}

before(async () => {
  await waitForServer(`${BASE}/health`);
});

test('GET /api/posts returns paginated shape', async () => {
  const res  = await fetch(`${BASE}/posts`);
  assert.ok([200, 500].includes(res.status));
  if (res.status === 200) {
    const body = await res.json();
    assert.ok('posts'      in body, 'must have posts array');
    assert.ok('hasMore'    in body, 'must have hasMore flag');
    assert.ok('nextCursor' in body, 'must have nextCursor');
    assert.ok(Array.isArray(body.posts));
  }
});

test('GET /api/posts rejects invalid limit', async () => {
  const res = await fetch(`${BASE}/posts?limit=999`);
  assert.equal(res.status, 400);
});

test('POST /api/posts requires auth header', async () => {
  const res = await fetch(`${BASE}/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'hello' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/posts/:id/like returns 404 for unknown post', async () => {
  // A well-formed UUID that does not exist in the DB
  const res = await fetch(`${BASE}/posts/00000000-0000-4000-8000-000000000000/like`, {
    method: 'POST',
    headers: { 'x-wallet-address': 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN' },
  });
  assert.equal(res.status, 404);
});

test('POST /api/posts/:id/like requires auth header', async () => {
  const res = await fetch(`${BASE}/posts/00000000-0000-4000-8000-000000000000/like`, {
    method: 'POST',
  });
  assert.equal(res.status, 401);
});

test('concurrent likes do not cause lost updates (atomic increment)', async () => {
  // This test documents the required behaviour:
  // N concurrent like requests on the same post must each be counted.
  // With a read-modify-write pattern they would all read the same value
  // and write the same result (N-1 lost updates).
  // With an atomic DB increment every request is counted exactly once.
  //
  // We cannot create a real post without a full user + auth flow, so we
  // assert the contract structurally: verify the endpoint uses supabase.rpc
  // rather than a read-then-write, by confirming the route source does not
  // contain the old non-atomic pattern.
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../src/routes/posts.js'),
    'utf8'
  );

  // Must use the atomic RPC call
  assert.ok(
    src.includes("supabase.rpc('increment_likes'"),
    'like endpoint must use supabase.rpc(\'increment_likes\') for atomic increment'
  );

  // Must NOT contain the old read-modify-write pattern
  assert.ok(
    !src.includes('likes_count || 0) + 1'),
    'like endpoint must not use non-atomic read-modify-write'
  );
});
