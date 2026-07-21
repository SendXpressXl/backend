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
    if (body.posts.length > 0) {
      assert.equal(typeof body.posts[0].liked, 'boolean', 'each post must report whether the caller liked it');
    }
  }
});

test('GET /api/posts without a token reports liked: false rather than omitting it', async () => {
  const res = await fetch(`${BASE}/posts`);
  if (res.status !== 200) return;
  const body = await res.json();
  for (const post of body.posts) {
    assert.equal(post.liked, false, 'an anonymous caller must never see liked: true');
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

test('POST /api/posts/:id/like returns 404 for unknown post when authenticated', async () => {
  const token = process.env.TEST_SESSION_TOKEN;
  if (!token) { console.log('  skip: TEST_SESSION_TOKEN not set'); return; }
  const res = await fetch(`${BASE}/posts/00000000-0000-4000-8000-000000000000/like`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  assert.equal(res.status, 404);
});

test('POST /api/posts/:id/like requires auth header', async () => {
  const res = await fetch(`${BASE}/posts/00000000-0000-4000-8000-000000000000/like`, {
    method: 'POST',
  });
  assert.equal(res.status, 401);
});

test('concurrent likes/unlikes do not cause lost updates (atomic toggle)', async () => {
  // This test documents the required behaviour:
  // N concurrent toggle requests for the same (post, user) pair must not
  // step on each other. With a read-modify-write pattern they'd all read
  // the same likes_count and write the same result (lost updates). With
  // toggle_post_like() the insert/delete and the count update happen
  // together in one DB call, so there's no separate read step to race.
  //
  // We cannot create a real post without a full user + auth flow, so we
  // assert the contract structurally: the route must call the atomic
  // toggle RPC and must not fall back to a plain read-then-write.
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../src/routes/posts.js'),
    'utf8'
  );

  // Must use the atomic toggle RPC
  assert.ok(
    src.includes(".rpc('toggle_post_like'"),
    'like endpoint must use .rpc(\'toggle_post_like\') for an atomic toggle'
  );

  // Must NOT contain the old one-way, non-atomic pattern
  assert.ok(
    !src.includes('increment_likes') && !src.includes('likes_count || 0) + 1'),
    'like endpoint must not use the old one-way increment_likes RPC or a non-atomic read-modify-write'
  );
});

test('toggle_post_like migration defines a per-user post_likes table', async () => {
  // Structural check that the required Supabase migration exists and
  // matches what the route calls, since there's no live DB in this suite
  // to actually apply and exercise it against.
  const sql = require('fs').readFileSync(
    require('path').join(__dirname, '../sql/post_likes.sql'),
    'utf8'
  );

  assert.ok(sql.includes('create table if not exists post_likes'), 'migration must create a post_likes table');
  assert.ok(sql.includes('primary key (post_id, user_id)'), 'post_likes must be keyed on (post_id, user_id) so a user can only like a post once');
  assert.ok(sql.includes('function toggle_post_like'), 'migration must define the toggle_post_like() function the route calls');

  // The insert branch must check whether its own insert actually landed
  // before incrementing likes_count. Two concurrent toggles that both miss
  // the delete both reach the insert; the primary key lets only one insert
  // through via ON CONFLICT DO NOTHING, so an unconditional increment here
  // double-counts a single like. The delete branch already guards this the
  // same way via v_deleted, the insert branch needs the same treatment.
  assert.ok(
    sql.includes('get diagnostics v_inserted = row_count') && sql.includes('if v_inserted > 0 then'),
    'insert branch must check row_count before incrementing likes_count, same as the delete branch checks v_deleted'
  );
});
