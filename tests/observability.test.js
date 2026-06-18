/**
 * Integration tests for observability, error boundaries, and the health endpoint.
 *
 * Prerequisites: the server must be running before this suite executes.
 * Start it with `npm run dev` or `npm start` in a separate terminal, or the
 * test runner will wait up to 5 s for it to become ready via waitForServer.
 *
 * These tests verify:
 *   - The process does not crash on DB errors
 *   - The response is { error: string, traceId } — no raw DB objects
 *   - GET /health returns a structured response and 503 when a dep is down
 */

const assert  = require('node:assert/strict');
const { test, before } = require('node:test');

const BASE = 'http://localhost:3000/api';

// ── Setup ────────────────────────────────────────────────────────────────────

/**
 * Wait until the server is accepting connections (up to 5 s).
 */
async function waitForServer(url, retries = 10, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error(`Server at ${url} did not become ready in time`);
}

before(async () => {
  await waitForServer(`${BASE}/health`);
});

// ── Structured request logging / traceId ────────────────────────────────────

test('every error response has an error field', async () => {
  const res = await fetch(`${BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}), // missing wallet → 400
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error, 'response must have an error field');
});

test('error responses on DB failure return { error: string } not raw Supabase object', async () => {
  const res = await fetch(`${BASE}/users/not-a-valid-uuid/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'buyer' }),
  });

  assert.ok([400, 404, 500].includes(res.status), `unexpected status ${res.status}`);
  const body = await res.json();

  // error must be a plain string, not a raw Supabase error object
  assert.equal(typeof body.error, 'string', 'error field must be a plain string, not an object');

  // Must not contain Supabase-specific internal fields
  assert.ok(!('code'    in body), 'raw Supabase "code" field must not be exposed');
  assert.ok(!('details' in body), 'raw Supabase "details" field must not be exposed');
  assert.ok(!('hint'    in body), 'raw Supabase "hint" field must not be exposed');
});

// ── Health endpoint ──────────────────────────────────────────────────────────

test('GET /api/health returns structured response with checks object', async () => {
  const res  = await fetch(`${BASE}/health`);
  const body = await res.json();

  // Must be 200 (ok) or 503 (degraded) — never a raw error or 500
  assert.ok([200, 503].includes(res.status), `unexpected status ${res.status}`);
  assert.ok(['ok', 'degraded'].includes(body.status), 'status must be "ok" or "degraded"');
  assert.ok(body.checks,                'must include checks object');
  assert.ok('database' in body.checks,  'checks must include database');
  assert.ok('stellar'  in body.checks,  'checks must include stellar');
  assert.ok(body.ts,                    'must include ISO timestamp');
});

test('GET /api/health check values are either "ok" or "error"', async () => {
  const res  = await fetch(`${BASE}/health`);
  const body = await res.json();

  assert.ok(['ok', 'error'].includes(body.checks.database), 'database check must be "ok" or "error"');
  assert.ok(['ok', 'error'].includes(body.checks.stellar),  'stellar check must be "ok" or "error"');
});

// ── No raw errors leaked from any route ─────────────────────────────────────

test('Supabase error in GET /api/listings does not leak raw DB error', async () => {
  const res  = await fetch(`${BASE}/listings`);
  const body = await res.json();

  assert.ok([200, 500, 503].includes(res.status));

  if (res.status === 500) {
    assert.equal(typeof body.error, 'string', 'error must be a plain string');
    assert.ok(!('code' in body), 'must not expose Supabase code');
  }
});

test('server stays alive after a handled async error', async () => {
  // Trigger a handled error
  await fetch(`${BASE}/users/not-a-valid-uuid/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'buyer' }),
  });

  // Server must still respond — process did not crash
  const res = await fetch(`${BASE}/health`);
  assert.ok([200, 503].includes(res.status), 'server must still be alive after error');
});

// ── traceId propagation ──────────────────────────────────────────────────────

test('auth challenge 500 response includes traceId', async () => {
  // Issue a challenge with a wallet value — if Supabase is down this returns
  // 500 with traceId. If Supabase is up it returns 200 (no traceId needed).
  // Either way verify the shape is correct.
  const res  = await fetch(`${BASE}/auth/challenge?wallet=GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN`);
  const body = await res.json();

  if (res.status === 500) {
    assert.equal(typeof body.error,   'string', 'error must be a string');
    assert.equal(typeof body.traceId, 'string', 'traceId must be present on 500');
  } else {
    // Success path — nonce returned
    assert.ok(body.nonce, 'nonce must be present on success');
  }
});
